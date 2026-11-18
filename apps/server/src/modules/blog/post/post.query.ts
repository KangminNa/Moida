import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseQuery,
  Database,
  LibraryInput,
  type LibraryRow,
  Lookups,
  NotFound,
} from '../../platform';
import { App } from '../app/app';
import type { PostRow } from '../blog.tables';
import { type LoadedPost, Post } from './post';
import { ListPostsInput, type PostSlugInput, type ReadPostInput } from './post.input';
import {
  type PostAppRow,
  PostCountsView,
  PostPageView,
  PostSummaryView,
  PostView,
  PublicPostPageView,
  PublicPostSummaryView,
  PublicPostView,
  ToolPostView,
} from './post.view';

/** 글 하나를 읽을 때의 한 줄: 지금 판 · 판 수 · 참고 wiki와 든 앱 */
interface ShownPost extends LoadedPost, PostAppRow {}

// 글 읽기. 방문자는 공개 글만 목록에 보이고, 링크만 글은 주소로만 열린다. 임시·휴지통 글은 없는 글과 같다.
// 비공개까지 볼 수 있는 요청자(주인, read_all 기기)는 전부 본다.
// 방문자는 공간을 모른다: MVP는 공간이 하나라 공간으로 거르지 않는다 (여럿이 되면 Guard가 주소로 공간을 정한다).
@Injectable()
export class PostQuery extends BaseQuery {
  /** 보관함의 종류 (글) */
  static readonly LIBRARY_KIND = 'post';
  private static readonly PAGE = 20;

  constructor(
    db: Database,
    private readonly lookups: Lookups,
  ) {
    super(db);
  }

  /** 주인에게는 공개 범위·판 수·탭별 글 수까지, 그 밖에는 읽을 것만 */
  async list(actor: Actor, req: ListPostsInput): Promise<PostPageView | PublicPostPageView> {
    const all = actor.canSeePrivate();
    // 주인은 고친 순서, 방문자는 발행한 순서
    const at = all ? this.sql`p.updated_at` : this.sql`p.published_at`;
    const rows = await this.sql<(PostAppRow & { revision_count: number })[]>`
      SELECT p.*, a.slug AS app_slug, a.name AS app_name,
        (SELECT count(*) FROM blog.post_revisions x WHERE x.post_id = p.id)::int AS revision_count
      FROM blog.posts p LEFT JOIN blog.apps a ON a.id = p.app_id
      WHERE ${this.inSpace(actor)} ${this.filter(all, req.status)}
        ${req.app === null ? this.sql`` : this.sql`AND a.slug = ${req.app}`}
        ${req.menu === null ? this.sql`` : this.sql`AND p.menu_id IN (SELECT m.id FROM blog.menus m WHERE m.slug = ${req.menu} AND m.app_id = p.app_id)`}
        ${req.before === null ? this.sql`` : this.sql`AND (${at}, p.id) < (${req.before[0]}, ${req.before[1]})`}
      ORDER BY ${at} DESC, p.id DESC
      LIMIT ${PostQuery.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, PostQuery.PAGE, (last) => {
      const lastAt = all ? last.updated_at : last.published_at;
      return lastAt ? ListPostsInput.cursorAfter(lastAt, last.id) : null;
    });
    return all
      ? new PostPageView(
          items.map((r) => new PostSummaryView(r, r.revision_count)),
          next,
          await this.counts(actor),
        )
      : new PublicPostPageView(
          items.map((r) => new PublicPostSummaryView(r)),
          next,
        );
  }

  /** 주소로 글 하나. 방문자는 공개·링크만 글, 주인은 임시 글도 (미리 보기) */
  async bySlug(actor: Actor, req: PostSlugInput): Promise<PostView | PublicPostView> {
    const all = actor.canSeePrivate();
    const [row] = await this.sql<ShownPost[]>`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.slug = ${req.slug} AND p.deleted_at IS NULL
        ${all ? this.sql`` : this.sql`AND p.status IN (${Post.PUBLISHED}, ${Post.UNLISTED}) AND a.visibility = ${App.PUBLIC}`}`;
    return PostQuery.view(actor, PostQuery.found(row));
  }

  /** 편집기가 여는 글 하나 (휴지통 글 포함). 글을 쓸 수 있는 요청자만 */
  async get(actor: Actor, req: ReadPostInput): Promise<PostView | PublicPostView> {
    actor.assertCan(Actor.WRITE);
    const [row] = await this.sql<ShownPost[]>`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.id = ${req.id}`;
    return PostQuery.view(actor, PostQuery.found(row));
  }

  /**
   * 고칠 수 있는 글 하나 (AI 도구의 읽기, 소재 담기, 사진 올리기). 휴지통 글은 없는 글과 같다.
   * 비공개를 볼 수 없는 요청자에게는 볼 수 있는 wiki만 잇는다
   */
  async editable(actor: Actor, req: ReadPostInput): Promise<ToolPostView> {
    // 이 작업에만 읽기를 허락받은 글(대화의 참조, Actor.mayRead)은 쓰기 권한 없이도 읽는다 (2026-11-15 B)
    if (!actor.mayRead(req.id)) actor.assertCan(Actor.WRITE);
    const [row] = await this.sql<ShownPost[]>`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.id = ${req.id} AND p.deleted_at IS NULL`;
    const r = PostQuery.found(row);
    const main = r.main_wiki_id;
    const refs = r.ref_wiki_ids ?? [];
    const seen = actor.canSeePrivate()
      ? null
      : await this.lookups.visible('wiki', actor, [...(main === null ? [] : [main]), ...refs]);
    const shown = (id: string) => seen === null || seen.has(id);
    return new ToolPostView(
      r,
      r.head_body ?? '',
      main !== null && shown(main) ? main : null,
      refs.filter(shown),
    );
  }

  private async counts(actor: Actor): Promise<PostCountsView> {
    const [c] = await this.sql<
      { draft: number; published: number; unlisted: number; trash: number }[]
    >`
      SELECT count(*) FILTER (WHERE deleted_at IS NULL AND status = ${Post.DRAFT})::int AS draft,
             count(*) FILTER (WHERE deleted_at IS NULL AND status = ${Post.PUBLISHED})::int AS published,
             count(*) FILTER (WHERE deleted_at IS NULL AND status = ${Post.UNLISTED})::int AS unlisted,
             count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trash
      FROM blog.posts p WHERE ${this.inSpace(actor)}`;
    return new PostCountsView(c?.draft ?? 0, c?.published ?? 0, c?.unlisted ?? 0, c?.trash ?? 0);
  }

  /** 목록에서 볼 글: 방문자는 공개 앱의 공개 글만 (스토어 1단계), 주인은 고른 탭 (없으면 휴지통 말고 전부) */
  private filter(all: boolean, status: string | null) {
    if (!all)
      return this
        .sql`AND p.status = ${Post.PUBLISHED} AND p.deleted_at IS NULL AND a.visibility = ${App.PUBLIC}`;
    if (status === ListPostsInput.TRASH) return this.sql`AND p.deleted_at IS NOT NULL`;
    if (status === null) return this.sql`AND p.deleted_at IS NULL`;
    return this.sql`AND p.status = ${status} AND p.deleted_at IS NULL`;
  }

  private inSpace(actor: Actor) {
    return actor.spaceId === null ? this.sql`TRUE` : this.sql`p.space_id = ${actor.spaceId}`;
  }

  /** 글 한 줄과 지금 판, 판 수, 참고 wiki (PostRepository가 불러오는 것과 같은 모양)와 든 앱 (a, 스토어 1단계) */
  private selectOne() {
    return this.sql`
      SELECT p.*, r.title AS head_title, r.body_md AS head_body, a.slug AS app_slug, a.name AS app_name,
             (SELECT count(*) FROM blog.post_revisions x WHERE x.post_id = p.id)::int AS revision_count,
             (SELECT array_agg(x.wiki_id ORDER BY x.wiki_id)
              FROM blog.post_wiki_refs x WHERE x.post_id = p.id) AS ref_wiki_ids
      FROM blog.posts p LEFT JOIN blog.post_revisions r ON r.id = p.head_revision_id
        LEFT JOIN blog.apps a ON a.id = p.app_id`;
  }

  private static found(row: ShownPost | undefined): ShownPost {
    if (!row) throw new NotFound('글을 찾을 수 없어요');
    return row;
  }

  /** 제목은 찾기용 사본(posts.title)을 보여 준다. 주인에게는 공개 범위·버전과 wiki 연결까지 */
  private static view(actor: Actor, r: ShownPost): PostView | PublicPostView {
    const body = r.head_body ?? '';
    return actor.canSeePrivate()
      ? new PostView(r, body, r.revision_count, r.ref_wiki_ids ?? [])
      : new PublicPostView(r, body);
  }

  /** 보관함의 글 (2차 5단계, platform LibraryQuery에 등록). 휴지통 밖, 공개 · 링크 공개 글은 바깥 주소도 */
  /**
   * 결재한 발행을 실행하기 전에 빠진 점 (platform ActionChecks, 2차 6단계 받을 것 "블로그"의 검사).
   * 앱에 넣지 않은 글(공개할 수 없다) · 메뉴에도 호에도 올리지 않은 글이면 그 말을, 없는 글이면 null (발행이 실패로 알린다)
   */
  async publishProblem(actor: Actor, postId: string): Promise<string | null> {
    actor.assertOwnerOrSystem();
    const [row] = await this.sql<Pick<PostRow, 'title' | 'app_id' | 'menu_id' | 'issue_id'>[]>`
      SELECT title, app_id, menu_id, issue_id FROM blog.posts WHERE id = ${postId} AND deleted_at IS NULL`;
    if (!row) return null;
    if (row.app_id === null) return `앱에 넣지 않은 글: ${row.title || '제목 없음'}`;
    if (row.menu_id !== null || row.issue_id !== null) return null;
    return `메뉴에 올리지 않은 글: ${row.title || '제목 없음'}`;
  }

  async library(actor: Actor, filter: LibraryInput): Promise<readonly LibraryRow[]> {
    actor.assertOwner();
    if (filter.project !== null) return [];
    const rows = await this.sql<
      (Pick<PostRow, 'id' | 'slug' | 'title' | 'status' | 'updated_at' | 'menu_id'> & {
        menu: string | null;
      })[]
    >`
      SELECT p.id, p.slug, p.title, p.status, p.updated_at, p.menu_id, m.name AS menu
      FROM blog.posts p LEFT JOIN blog.menus m ON m.id = p.menu_id
      WHERE p.space_id = ${actor.requireSpace()} AND p.deleted_at IS NULL
        ${this.libraryWindow('p.updated_at', 'p.id', 'p.title', filter)}
      ORDER BY p.updated_at DESC, p.id DESC LIMIT ${LibraryInput.PAGE + 1}`;
    return rows.map((r) => ({
      kind: PostQuery.LIBRARY_KIND,
      id: r.id,
      title: r.title || '제목 없음',
      project: null,
      at: r.updated_at,
      href: `/admin/posts/${r.id}`,
      url: r.status === Post.DRAFT ? null : `/posts/${r.slug}`,
      visibility: r.status,
      placeId: r.menu_id,
      place: r.menu,
    }));
  }
}
