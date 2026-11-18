import { createHash } from 'node:crypto';
import {
  ArchiveBlob,
  ArchiveFile,
  ArchivePart,
  ArchiveQuery,
  ArchiveRecord,
  BaseEntity,
  Blob,
  RuleViolation,
  type Sql,
} from '../../platform';
import { RestoredApp } from '../app/restored-app';
import { RestoredAppCode } from '../app-code/restored-app-code';
import { ImagePolicy } from '../asset/image.policy';
import {
  POST_ALIGN,
  POST_STATUS,
  type PostNew,
  type PostRevisionNew,
  type PostStatus,
} from '../blog.tables';
import { PostContent } from './post-content';
import { PostRestoreRepository } from './post-restore.repository';
import { SlugPolicy } from './slug.policy';

/** blog/posts/<연도>/<주소>.md 하나. 지금 판이 첫 판이 되고, 찾기용 글은 저장할 때와 같은 PostContent로 다시 만든다 */
export class RestoredPost extends BaseEntity {
  private static readonly FILE_REFERENCE = /\/api\/files\/([0-9a-f]{64})/g;
  private static readonly KNOWN: ReadonlySet<string> = new Set([
    'cairn_format',
    'cairn_type',
    'cairn_id',
    'title',
    'slug',
    'status',
    'published',
    'cairn_app',
    'cairn_main_wiki',
    'cairn_ref_wikis',
    'cairn_assets',
    'tags',
    'align',
  ]);
  /** 복원한 첫 판을 만든 쪽 (post_revisions.actor_type) */
  private static readonly SYSTEM = 'system';
  private static readonly DRAFT: PostStatus = 'draft';

  private constructor(
    /** 글 행. 공간은 넣을 때 정해진다 */
    private readonly fields: Omit<PostNew, 'space_id'>,
    /** 첫 판 */
    readonly revision: PostRevisionNew,
    readonly refWikiIds: readonly string[],
    /** 이 글에 붙은 사진의 해시 */
    readonly photos: readonly string[],
  ) {
    super(fields.id, 1);
  }

  static read(record: ArchiveRecord): RestoredPost {
    const content = record.attempt(() => PostContent.write(record.text('title'), record.body));
    const publishedAt = record.date('published');
    const fields = {
      id: record.id(),
      slug: record.attempt(() => SlugPolicy.check(record.text('slug'))),
      status: record.oneOf('status', POST_STATUS),
      title: content.title,
      excerpt: content.excerpt,
      head_text: content.searchText,
      tags: record.texts('tags'),
      align: record.has('align') ? record.oneOf('align', POST_ALIGN) : 'left',
      main_wiki_id: record.optionalId('cairn_main_wiki'),
      app_id: record.optionalId('cairn_app'),
      published_at: publishedAt,
    };
    const refWikiIds = record.ids('cairn_ref_wikis');
    // 첫 판의 때. 임시 글의 연도 폴더가 이 값으로 정해지므로 내보낼 때 경로가 그대로다
    const writtenAt = publishedAt ?? record.createdAt;
    const photos = RestoredPost.photosOf(record);
    const meta = ArchiveFile.metaOf(record.unknownKeys(RestoredPost.KNOWN));
    const revisionId = BaseEntity.newId();
    return new RestoredPost(
      { ...fields, head_revision_id: revisionId, updated_at: writtenAt, meta },
      {
        id: revisionId,
        post_id: fields.id,
        seq: 1,
        title: content.title,
        body_md: content.body,
        actor_type: RestoredPost.SYSTEM,
        created_at: writtenAt,
      },
      refWikiIds,
      photos,
    );
  }

  get slug(): string {
    return this.fields.slug;
  }

  /** 든 앱 (cairn_app). 앱 밖의 글은 null */
  get appId(): string | null {
    return this.fields.app_id ?? null;
  }

  /** 방문자에게 보이는 상태인가 (공개 · 링크 공개): 앱 안의 글만 그럴 수 있다 */
  get shown(): boolean {
    return this.fields.status !== RestoredPost.DRAFT;
  }

  /** 이 공간에 넣을 글 행. appId: 넣을 앱 (옛 백업은 기본 앱) */
  rowIn(spaceId: string, appId: string | null): PostNew {
    return { ...this.fields, space_id: spaceId, app_id: appId };
  }

  /** 글에 붙은 사진. 목록이 없는 옛 백업은 본문이 쓰는 사진(/api/files/<해시>)으로 알아낸다 */
  private static photosOf(record: ArchiveRecord): readonly string[] {
    if (!record.has('cairn_assets'))
      return [
        ...new Set([...record.body.matchAll(RestoredPost.FILE_REFERENCE)].map((m) => m[1] ?? '')),
      ];
    const hashes = record.texts('cairn_assets');
    const bad = hashes.find((hash) => !Blob.isHash(hash));
    if (bad !== undefined) throw record.problem(`cairn_assets의 해시가 틀렸어요: ${bad}`);
    return [...new Set(hashes)];
  }
}

// 복원에서 blog의 몫: 앱, 앱 코드(blog/apps/<주소>/code/, 버전 1이 된다), 글, 사진. 글 → wiki 연결은 값이라 wiki가 묶음에 없어도(공개 저장소) 그대로 둔다.
// 글 자리 사본(vault.post_marks)과 앱 공개 여부 사본(vault.app_marks)은 vault의 몫이고, 이벤트를 남기지 않는다: 플러그인과 일꾼이 할 일이 생기지 않는다.
// 앱 파일이 없는데 공개 · 링크 공개 글이 있으면 앱이 생기기 전의 백업이다: 글을 모두 기본 앱(RestoredApp.former)에 넣는다.
export class PostRestore extends ArchivePart {
  private static readonly APP = /^blog\/apps\/[^/]+\.yml$/;
  private static readonly POST = /^blog\/posts\/.+\.md$/;
  private static readonly PHOTO = /^assets\/([0-9a-f]{64})\.([a-z0-9]+)$/;

  private constructor(
    private readonly apps: readonly RestoredApp[],
    private readonly posts: readonly RestoredPost[],
    private readonly photos: ReadonlyMap<string, ArchiveBlob>,
    /** 앱 주소마다 백업 때 보이던 코드 */
    private readonly codes: ReadonlyMap<string, RestoredAppCode>,
    /** 앱이 생기기 전의 백업인가 */
    private readonly former: boolean,
  ) {
    super();
  }

  static read(files: readonly ArchiveFile[]): PostRestore {
    const apps: RestoredApp[] = [];
    const posts: RestoredPost[] = [];
    const photos = new Map<string, ArchiveBlob>();
    const code: ArchiveFile[] = [];
    for (const file of files) {
      if (PostRestore.APP.test(file.path)) {
        const text = PostRestore.textOf(file);
        for (const record of ArchiveRecord.listOfYaml(file.path, text))
          apps.push(RestoredApp.read(record));
      } else if (PostRestore.POST.test(file.path)) {
        posts.push(RestoredPost.read(PostRestore.document(file, 'post', ArchiveQuery.FORMAT)));
      } else if (RestoredAppCode.PATH.test(file.path)) {
        code.push(file);
      } else if (file.path.startsWith('assets/')) {
        const [hash, blob] = PostRestore.photo(file);
        photos.set(hash, blob);
      } else if (file.path.startsWith('blog/')) {
        throw new RuleViolation(`모르는 파일이에요: ${file.path}`);
      }
    }
    PostRestore.assertUnique(
      apps.map((a) => a.id),
      '앱 id',
    );
    PostRestore.assertUnique(
      apps.map((a) => a.slug),
      '앱 주소',
    );
    if (apps.filter((a) => a.home).length > 1)
      throw new RuleViolation('첫 화면으로 고정한 앱이 둘 이상이에요');
    PostRestore.assertUnique(
      posts.map((p) => p.id),
      '글 id',
    );
    PostRestore.assertUnique(
      posts.map((p) => p.slug),
      '글 주소',
    );
    const former = apps.length === 0 && posts.some((p) => p.shown);
    if (!former) PostRestore.assertInApps(apps, posts);
    const codes = RestoredAppCode.read(code);
    const slugs = new Set(apps.map((a) => a.slug));
    for (const slug of codes.keys())
      if (!slugs.has(slug)) throw new RuleViolation(`없는 앱의 코드예요: blog/apps/${slug}/code/`);
    return new PostRestore(apps, posts, photos, codes, former);
  }

  /** 글이 가리키는 앱이 들어오는가, 보이는 글이 앱 안에 있는가 (DB의 외래키 · CHECK에 걸리기 전에 어느 글인지 알린다) */
  private static assertInApps(apps: readonly RestoredApp[], posts: readonly RestoredPost[]): void {
    const ids = new Set(apps.map((a) => a.id));
    for (const post of posts) {
      if (post.appId !== null && !ids.has(post.appId))
        throw new RuleViolation(`글 ${post.slug}: 없는 앱을 가리켜요: ${post.appId}`);
      if (post.appId === null && post.shown)
        throw new RuleViolation(`글 ${post.slug}: 앱 밖의 글은 공개할 수 없어요`);
    }
  }

  /** 이름이 곧 내용의 해시인지, 파일의 앞부분이 확장자와 같은 사진인지 본다. SVG 같은 다른 형식은 들어오지 못한다 */
  private static photo(file: ArchiveFile): readonly [string, ArchiveBlob] {
    const [, hash = '', extension] = PostRestore.PHOTO.exec(file.path) ?? [];
    if (!hash) throw new RuleViolation(`모르는 파일이에요: ${file.path}`);
    if (createHash('sha256').update(file.body).digest('hex') !== hash)
      throw new RuleViolation(`${file.path}: 내용이 파일 이름의 해시와 달라요`);
    const mime = ImagePolicy.mimeOf(file.body);
    if (!mime || ImagePolicy.EXTENSIONS[mime] !== extension)
      throw new RuleViolation(`${file.path}: 확장자와 다른 형식의 파일이에요`);
    return [hash, new ArchiveBlob(file.body, mime)];
  }

  get counts(): ReadonlyMap<string, number> {
    return PostRestore.present([
      ['앱', this.apps.length + (this.former ? 1 : 0)],
      ['앱 코드', this.codes.size],
      ['글', this.posts.length],
      ['사진', this.photos.size],
    ]);
  }

  override get blobs(): readonly ArchiveBlob[] {
    return [...this.photos.values(), ...[...this.codes.values()].flatMap((c) => c.blobs)];
  }

  override get notes(): readonly string[] {
    const attached = new Set(this.posts.flatMap((p) => p.photos));
    const icons = new Set(this.apps.flatMap((a) => (a.icon === null ? [] : [a.icon])));
    const lost = [...attached, ...icons].filter((hash) => !this.photos.has(hash)).length;
    const loose = [...this.photos.keys()].filter((h) => !attached.has(h) && !icons.has(h)).length;
    const pageApps = this.apps.filter((a) => a.isPage).length;
    return [
      ...(lost > 0 ? [`글 · 앱이 쓰는데 묶음에 없는 사진 ${lost}개는 빠져요`] : []),
      ...(loose > 0 ? [`어느 글에도 붙지 않은 사진 ${loose}개는 다음 내보내기에서 빠져요`] : []),
      ...(pageApps > 0
        ? [`페이지는 보관 파일에 없어 페이지 앱 ${pageApps}개는 페이지 없이 들어와요`]
        : []),
    ];
  }

  /** 있는 앱과 글의 수 (휴지통 포함: 주소를 차지한다). 끝날 때까지 새 앱 · 글이 끼어들지 못하게 잠근다 */
  async existing(tx: Sql): Promise<ReadonlyMap<string, number>> {
    const [apps, posts] = await new PostRestoreRepository(tx).existing();
    return PostRestore.present([
      ['앱', apps],
      ['글', posts],
    ]);
  }

  async write(tx: Sql, spaceId: string): Promise<readonly string[]> {
    const repository = new PostRestoreRepository(tx);
    const apps = this.former ? [RestoredApp.former(spaceId)] : this.apps;
    for (const app of apps) {
      const withIcon = app.icon !== null && this.photos.has(app.icon);
      await repository.saveApp(spaceId, app, withIcon, this.codes.get(app.slug) ?? null);
    }
    for (const post of this.posts) {
      const photos = post.photos.filter((hash) => this.photos.has(hash));
      await repository.save(spaceId, post, photos, this.former ? spaceId : post.appId);
    }
    return this.former
      ? [`앱이 생기기 전의 백업이라 글 ${this.posts.length}개를 블로그 앱(/blog)에 넣었어요`]
      : [];
  }
}
