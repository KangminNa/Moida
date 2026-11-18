import {
  Actor,
  ApprovedActor,
  BaseEntity,
  type ColumnRules,
  DomainEvent,
  Forbidden,
  RuleViolation,
  TableEntity,
  type Unchecked,
  ValueList,
} from '../../platform';
import {
  POST_ALIGN,
  POST_STATUS,
  type PostNew,
  type PostRow,
  type PostStatus,
} from '../blog.tables';
import type { Menu } from '../menu/menu';
import { PublicSavedPostView, SavedPostView, ToolDraftView } from './post.view';
import { PostContent } from './post-content';
import { PostPublish } from './post-publish.policy';
import { PostRevision } from './post-revision';

/** 글 한 줄과 함께 읽는 칸: 지금 판의 제목·본문, 판 수, 참고 wiki */
export interface LoadedPost extends PostRow {
  head_title: string | null;
  head_body: string | null;
  revision_count: number;
  ref_wiki_ids: readonly string[] | null;
}

// 글. 저장할 때 내용(제목·본문)이 바뀌었으면 새 판이 쌓인다. 주소·태그·정렬·공개 범위는 판 없이 글에 둔다.
// posts의 title·excerpt·head_text는 지금 판의 찾기용 사본이라 글이 바뀔 때마다 지금 판에서 다시 적는다.
// 공개 범위(status): draft 임시(나만) · published 공개(목록에 보임) · unlisted 링크만(목록·검색에는 안 나오고 주소로만).
// 공개 범위 바꾸기·휴지통·공개된 글 고치기는 주인만 (AI 도구의 글쓰기 권한은 임시 글까지, 원칙 7).
// 주인이 결재한 공개 하나만 예외다 (publishApproved).
// 글 → wiki 연결(대표 하나 + 참고 여럿)은 판 없이 글에 둔다. vault에는 이벤트로 알린다 (외래키 없음).
export class Post extends TableEntity<PostRow, PostNew> {
  static readonly DRAFT: PostStatus = 'draft';
  static readonly PUBLISHED: PostStatus = 'published';
  static readonly UNLISTED: PostStatus = 'unlisted';
  static readonly TAGS_MAX = 20;
  static readonly TAG_MAX = 40;
  /** 글 하나의 참고 wiki */
  static readonly REFS_MAX = 20;
  /** 휴지통에 둔 글을 영구히 지우기까지 (영구 삭제 일꾼은 뒤 단계) */
  static readonly TRASH_DAYS = 30;

  /** 글을 쓰는 쪽이 정하는 칸과 그 규칙 */
  private static readonly RULES: ColumnRules<PostRow> = {
    /** 모양과 겹침은 SlugPolicy가 먼저 본다 (겹침은 DB를 읽어야 안다) */
    slug: (value) => value,
    /** 앞뒤 빈칸·# 지우기, 빈 것·겹치는 것 빼기 */
    tags: (value) => {
      const clean = [
        ...new Set(
          value.map((t) => t.trim().replace(/^#+/, '').trim()).filter((t) => t.length > 0),
        ),
      ];
      if (clean.length > Post.TAGS_MAX)
        throw new RuleViolation(`태그는 ${Post.TAGS_MAX}개까지예요`);
      const long = clean.find((t) => t.length > Post.TAG_MAX);
      if (long) throw new RuleViolation(`태그는 ${Post.TAG_MAX}자까지예요: ${long}`);
      return clean;
    },
    align: (value) => {
      if (!ValueList.has(POST_ALIGN, value))
        throw new RuleViolation(`정렬은 ${POST_ALIGN.join(' · ')} 중 하나예요`);
      return value;
    },
  };

  /** 이번에 새로 쌓인 판 */
  private added: PostRevision | null = null;
  /** 이번에 wiki 연결이 바뀌었는가 (참고 wiki는 딸린 표라 바뀐 칸으로 알 수 없다) */
  private relinked = false;

  private constructor(
    row: PostRow | PostNew,
    /** 지금 판의 내용 */
    private head: PostContent,
    private revisions: number,
    /** 대표와 겹치지 않는 참고 wiki. 늘 id 순서다 */
    private refWikis: readonly string[],
    fresh = false,
  ) {
    super(row, fresh);
  }

  /** 요청자의 공간. 글은 공간에 속한다 */
  static spaceOf(by: Actor): string {
    if (!by.spaceId) throw new Forbidden(Actor.WRITE);
    return by.spaceId;
  }

  /**
   * 새 글: 임시 상태로 첫 판과 함께. 주소는 Service가 SlugPolicy로 겹치지 않게 정해 넣는다.
   * 적지 않은 태그는 없고 정렬은 left다
   */
  static open(
    by: Actor,
    content: PostContent,
    fields: Omit<Unchecked<PostNew>, 'id' | 'space_id'>,
    requestId: string,
    now: Date,
  ): Post {
    const post = new Post(
      {
        id: BaseEntity.newId(),
        space_id: Post.spaceOf(by),
        slug: fields.slug,
        status: Post.DRAFT,
        app_id: null,
        main_wiki_id: null,
        published_at: null,
      },
      content,
      0,
      [],
      true,
    );
    post.accept({ tags: [], align: 'left', ...fields }, Post.RULES);
    post.addRevision(content, requestId, by, now);
    post.touch(now);
    return post;
  }

  static restore(row: LoadedPost): Post {
    return new Post(
      row,
      PostContent.restore(row.head_title ?? '', row.head_body ?? ''),
      row.revision_count,
      row.ref_wiki_ids ?? [],
    );
  }

  /** 지금 주소 (고쳐 쓸 때 주소를 보내지 않으면 이 주소의 겹침을 다시 본다) */
  get slug(): string {
    return this.row.slug;
  }

  /** 든 앱 (스토어 1단계). 아직 앱에 없는 글은 null이고 공개할 수 없다 */
  get appId(): string | null {
    return this.row.app_id;
  }

  /** 든 호 (2차 6단계). 없으면 null */
  get issueId(): string | null {
    return this.row.issue_id;
  }

  /** 이번에 새로 쌓인 판 (Repository가 저장한다) */
  get addedRevision(): PostRevision | null {
    return this.added;
  }

  /** 저장할 참고 wiki (Repository가 저장한다). 바뀌지 않았으면 null */
  get unsavedRefs(): readonly string[] | null {
    return this.relinked ? this.refWikis : null;
  }

  /**
   * 고쳐 쓰기. 제목·본문이 바뀌었으면 새 판을 쌓는다. 주소·태그·정렬은 판 없이 바꾸고, 적지 않은 칸은 그대로다.
   * 공개된 글(공개·링크만)은 주인만 고친다.
   */
  edit(content: PostContent, changes: Partial<Unchecked<PostRow>>, by: Actor, now: Date): void {
    this.assertLive();
    if (this.row.status !== Post.DRAFT) Post.assertOwner(by);
    const before = this.row;
    this.accept(changes, Post.RULES);
    const revised = !content.sameAs(this.head);
    if (revised) this.addRevision(content, null, by, now);
    // 칸이 실제로 바뀌었을 때만 행이 새 객체가 된다 (put)
    if (this.row !== before) this.touch(now);
    if (revised && this.row.status === Post.PUBLISHED) this.announceUpdate();
  }

  /**
   * 글 → wiki 연결 바꾸기. undefined는 그대로, 대표 null과 참고 []는 비우기다.
   * 겹치는 참고와 대표와 같은 참고는 뺀다. 판은 쌓지 않는다 (판은 제목·본문만).
   * AI는 임시 글까지만 잇고, 공개된 글은 주인만. 결재한 공개는 공개만 하고 연결을 바꾸지 않는다.
   */
  linkWikis(
    mainWikiId: string | null | undefined,
    refWikiIds: readonly string[] | undefined,
    by: Actor,
    now: Date,
  ): void {
    if (mainWikiId === undefined && refWikiIds === undefined) return;
    if (by instanceof ApprovedActor)
      throw new Forbidden('publish', '승인한 공개는 wiki 연결을 바꾸지 못해요');
    this.assertLive();
    if (this.row.status !== Post.DRAFT) Post.assertOwner(by);
    const main = mainWikiId === undefined ? this.row.main_wiki_id : mainWikiId;
    const refs = Post.cleanRefs(refWikiIds ?? this.refWikis, main);
    if (main === this.row.main_wiki_id && refs.join('\n') === this.refWikis.join('\n')) return;
    this.put('main_wiki_id', main);
    this.refWikis = refs;
    this.relinked = true;
    this.touch(now);
    if (this.row.status === Post.PUBLISHED) this.announceUpdate();
  }

  /**
   * 앱 · 메뉴에 놓기 (2차 6단계, 스토어 1단계): 메뉴를 주면 앱은 그 메뉴의 앱, 메뉴가 null이면 메뉴에서 빼고 appId의 앱에
   * (null이면 앱에서도 뺀다. 공개된 글은 앱에서 뺄 수 없다). 올린 글은 공개 대기이고, 공개는 공개 범위로 정한다.
   * 공개된 글은 관리자만 옮긴다. 메뉴가 받는 종류인지는 메뉴가 본다. 호에서는 빠진다.
   * 이 요청자가 놓을 수 있는지(운영 팀, 스토어 2단계)는 PostService가 AppTeam으로 먼저 본다 (요청자의 보고 대상을 트랜잭션 전에 읽어서)
   */
  placeIn(appId: string | null, menu: Menu | null, by: Actor, now: Date): void {
    this.assertLive();
    if (this.row.status !== Post.DRAFT) Post.assertOwner(by);
    menu?.assertHolds('post');
    const app = menu?.appId ?? appId;
    if (app === null && this.row.status !== Post.DRAFT)
      throw new RuleViolation('공개된 글은 앱에서 뺄 수 없어요');
    const was = this.row.app_id;
    if ((menu?.id ?? null) === this.row.menu_id && app === was) return;
    this.put('app_id', app);
    this.put('menu_id', menu?.id ?? null);
    this.put('issue_id', null);
    this.put('issue_order', null);
    this.touch(now);
    // 공개 글이 다른 앱으로 가면 그래프 사본도 알아야 한다 (보이는지가 앱의 공개 여부를 따른다)
    if (app !== was && this.row.status === Post.PUBLISHED) this.announceUpdate();
  }

  /**
   * 호에 넣기 · 빼기 (2차 6단계): 순서(order)와 함께. 호에 든 글은 메뉴에서 빠지고 호의 앱(appId)에 든다 (글 목록 메뉴와 호 중 하나).
   * 빼면 앱에는 그대로 있다. 발행한 호의 글은 Issue가 막고, 공개된 글은 관리자만 옮긴다
   */
  joinIssue(
    issueId: string | null,
    appId: string | null,
    order: number,
    by: Actor,
    now: Date,
  ): void {
    this.assertLive();
    if (this.row.status !== Post.DRAFT) Post.assertOwner(by);
    if (issueId === this.row.issue_id && (issueId === null || order === this.row.issue_order))
      return;
    this.put('issue_id', issueId);
    this.put('issue_order', issueId === null ? null : order);
    if (issueId !== null) this.put('menu_id', null);
    if (issueId !== null) this.put('app_id', appId);
    this.touch(now);
  }

  /** 호와 함께 공개 (결재한 호 발행 · 관리자의 호 발행). 휴지통 글이면 까닭을 돌려주고 바꾸지 않는다 */
  publishWithIssue(now: Date): string | null {
    if (this.row.deleted_at) return `휴지통에 있는 글이 있어요: ${this.head.title}`;
    if (this.row.status === Post.PUBLISHED) return null;
    this.put('status', Post.PUBLISHED);
    if (!this.row.published_at) this.put('published_at', now);
    this.touch(now);
    this.announce('blog.post.published');
    return null;
  }

  /** 공개 범위 바꾸기. 처음 공개(공개·링크만)한 때를 발행일로 남긴다 */
  changeStatus(status: string, by: Actor, now: Date): void {
    Post.assertOwner(by);
    this.assertLive();
    if (!ValueList.has(POST_STATUS, status))
      throw new RuleViolation(`공개 범위는 ${POST_STATUS.join(' · ')} 중 하나예요`);
    const was = this.row.status;
    if (status === was) return;
    if (status !== Post.DRAFT && this.row.app_id === null)
      throw new RuleViolation('앱에 넣은 뒤 공개해요');
    this.put('status', status);
    if (status !== Post.DRAFT && !this.row.published_at) this.put('published_at', now);
    this.touch(now);
    if (status === Post.PUBLISHED) this.announce('blog.post.published');
    else if (was === Post.PUBLISHED) this.announce('blog.post.unpublished');
  }

  /**
   * 주인이 결재한 공개. 결재한 그대로일 때만 공개하고, 아니면 아무것도 바꾸지 않고 실패를 돌려준다.
   * 결과는 기록하지 않고 돌려준다: 같은 결재가 다시 오면 Service가 이 결과를 그대로 다시 낸다.
   */
  publishApproved(by: Actor, targetVersion: number, now: Date): DomainEvent {
    const approvalId = PostPublish.approvalOf(by);
    const problem = PostPublish.problemOf(this.row, this.version, targetVersion);
    if (problem) return PostPublish.failed(this.row.space_id, this.id, approvalId, problem);
    this.put('status', Post.PUBLISHED);
    if (!this.row.published_at) this.put('published_at', now);
    this.touch(now);
    return this.event('blog.post.published', { approvalId, outcome: 'done' });
  }

  /** 휴지통으로. 판과 주소는 그대로 두고, TRASH_DAYS 뒤에 영구히 지울 수 있다 */
  trash(by: Actor, now: Date): void {
    Post.assertOwner(by);
    this.assertLive();
    this.put('deleted_at', now);
    this.put('purge_after', new Date(now.getTime() + Post.TRASH_DAYS * 24 * 60 * 60 * 1000));
    this.touch(now);
    this.announce('blog.post.deleted');
  }

  /** 휴지통에서 되살리기. 공개 범위는 지우기 전 그대로 */
  recover(by: Actor, now: Date): void {
    Post.assertOwner(by);
    if (!this.row.deleted_at) throw new RuleViolation('휴지통에 있는 글이 아니에요');
    this.put('deleted_at', null);
    this.put('purge_after', null);
    this.touch(now);
    if (this.row.status === Post.PUBLISHED) this.announce('blog.post.published');
  }

  /**
   * 쓰기 결과. 제목과 앞부분은 찾기용 사본이 아니라 지금 판에서.
   * 비공개까지 보는 요청자(주인의 편집기)에게만 wiki 연결까지 (wiki id는 UUIDv7이라 만들어진 때가 드러난다)
   */
  view(by: Actor): SavedPostView | PublicSavedPostView {
    const { title, excerpt, body } = this.head;
    const row = { ...this.row, title, excerpt };
    const revised = this.added !== null;
    return by.canSeePrivate()
      ? new SavedPostView(row, body, this.revisions, revised, this.refWikis)
      : new PublicSavedPostView(row, body, this.revisions, revised);
  }

  /** blog_save_draft의 답 */
  draftView(site: string): ToolDraftView {
    return new ToolDraftView(this.row, site);
  }

  /** 같은 값은 적지 않는다: 아무것도 바뀌지 않으면 저장할 것도, 오를 버전도 없다 */
  protected override put<K extends keyof PostRow>(column: K, value: PostRow[K]): void {
    const was = this.row[column];
    const same =
      Array.isArray(was) && Array.isArray(value)
        ? was.join('\n') === value.join('\n')
        : was === value;
    if (!same) super.put(column, value);
  }

  private addRevision(content: PostContent, requestId: string | null, by: Actor, now: Date): void {
    const base = this.row.head_revision_id ?? null;
    this.revisions += 1;
    this.added = PostRevision.write(this.id, this.revisions, content, base, requestId, by, now);
    this.head = content;
    this.put('head_revision_id', this.added.id);
  }

  /** 고친 때를 적고 찾기용 사본(제목·앞부분·찾기용 글자)을 지금 판에 맞춘다 */
  private touch(now: Date): void {
    this.put('title', this.head.title);
    this.put('excerpt', this.head.excerpt);
    this.put('head_text', this.head.searchText);
    this.put('updated_at', now);
  }

  private announce(topic: string): void {
    this.record(this.event(topic));
  }

  /**
   * 공개 글이 바뀌었다고 알린다. 한 번의 저장에 내용과 연결이 함께 바뀌어도 이벤트는 마지막 모습 하나다:
   * 두 이벤트의 postVersion이 같아 vault 사본은 앞의 것만 받으므로, 앞의 것을 버리고 다시 적는다.
   */
  private announceUpdate(): void {
    this.pullEvents();
    this.announce('blog.post.updated');
  }

  /** vault의 글 자리 사본이 순서를 맞추도록 저장 뒤의 글 버전을 함께 보낸다 */
  private event(topic: string, more: Readonly<Record<string, unknown>> = {}): DomainEvent {
    return new DomainEvent(topic, 1, this.row.space_id, {
      postId: this.id,
      slug: this.row.slug,
      title: this.head.title,
      status: this.row.status,
      appId: this.row.app_id,
      postVersion: this.isNew ? 1 : this.version + 1,
      mainWikiId: this.row.main_wiki_id,
      refWikiIds: this.refWikis,
      ...more,
    });
  }

  private assertLive(): void {
    if (this.row.deleted_at)
      throw new RuleViolation('휴지통에 있는 글이에요. 되살린 뒤 고쳐 주세요');
  }

  private static assertOwner(by: Actor): void {
    if (by.kind !== 'owner')
      throw new Forbidden('publish', '공개 범위·휴지통·공개된 글 편집은 관리자만 할 수 있어요');
  }

  /** 참고 wiki: 겹치는 것과 대표와 같은 것을 빼고 id 순서로 (보낸 순서만 달라서는 바뀐 것이 아니다) */
  private static cleanRefs(refs: readonly string[], main: string | null): readonly string[] {
    return [...new Set(refs)].filter((id) => id !== main).sort();
  }
}
