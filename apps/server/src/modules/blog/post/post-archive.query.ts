import { buffer } from 'node:stream/consumers';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type Actor,
  ArchiveFile,
  ArchiveQuery,
  BaseQuery,
  BlobStore,
  Database,
  NotFound,
} from '../../platform';
import { App } from '../app/app';
import { AppCodeQuery } from '../app-code/app-code.query';
import { ImagePolicy } from '../asset/image.policy';
import type { AppRow, AssetRow, PostRow } from '../blog.tables';
import { Post } from './post';
import { PostRestore } from './post-restore';

/** 보관 파일로 쓰는 글 한 줄: 글의 칸 일부와 지금 판의 본문, 첫 판의 때, 참고 wiki, 붙은 사진 */
interface ArchivedPost
  extends Pick<
    PostRow,
    | 'id'
    | 'slug'
    | 'status'
    | 'title'
    | 'tags'
    | 'align'
    | 'main_wiki_id'
    | 'published_at'
    | 'meta'
    | 'app_id'
  > {
  /** 든 앱이 공개인가 (앱 밖이면 null) */
  app_public: boolean | null;
  body_md: string;
  first_at: Date;
  refs: string[] | null;
  assets: string[] | null;
}

// 글의 보관 파일 (docs/보관형식.md): 앱 blog/apps/<주소>.yml과 보이는 코드 blog/apps/<주소>/code/<파일>(스토어 1-6c),
// 글 blog/posts/<연도>/<주소>.md와 사진 · 앱 아이콘 assets/<sha256>.<확장자>.
// 공개 저장소에는 공개 앱(과 그 코드)과, 공개 앱에 든 공개 글 · 그 사진만 (스토어 1-3).
// 현재 판만, 휴지통 글과 휴지통 글에만 붙은 사진은 빼고. 글마다 붙은 사진 목록(cairn_assets)도 적어 복원 때 행이 그대로 돌아온다.
// 카테고리·시리즈·표지는 그 기능이 생기는 단계에서 앞부분에 더한다.
@Injectable()
export class PostArchiveQuery extends BaseQuery implements OnModuleInit {
  private readonly logger = new Logger('보관 파일');

  constructor(
    db: Database,
    private readonly archive: ArchiveQuery,
    private readonly blobs: BlobStore,
    private readonly code: AppCodeQuery,
  ) {
    super(db);
  }

  onModuleInit(): void {
    this.archive.register('blog', (actor) => this.files(actor));
    this.archive.registerRestore('blog', (files) => PostRestore.read(files), ['vault']);
  }

  async files(actor: Actor): Promise<readonly ArchiveFile[]> {
    const apps = await this.appRows(actor);
    return [
      ...this.apps(apps),
      ...(await this.appCode(actor, apps)),
      ...(await this.posts(actor)),
      ...(await this.photos(actor, apps)),
    ];
  }

  /** 앱 전부 (앱에는 휴지통이 없다), 순서대로. 아이콘은 사진과 함께 assets/로 */
  private appRows(actor: Actor) {
    return this.sql<AppRow[]>`
      SELECT * FROM blog.apps
      WHERE ${actor.spaceId === null ? this.sql`TRUE` : this.sql`space_id = ${actor.spaceId}`}
      ORDER BY sort, created_at, id`;
  }

  /** 앱 하나에 파일 하나: 비공개 앱은 공개 저장소로 보내지 않는다 */
  private apps(rows: readonly AppRow[]): ArchiveFile[] {
    return rows.map((r) => {
      const file = ArchiveFile.yamlList(`blog/apps/${r.slug}.yml`, [
        {
          cairn_id: r.id,
          kind: r.kind,
          name: r.name,
          slug: r.slug,
          description: r.description,
          visibility: r.visibility,
          sort: r.sort,
          ...(r.icon_blob_hash === null ? {} : { icon: r.icon_blob_hash }),
          // 첫 화면 고정 (스토어 2단계)만 싣는다. 운영 팀장은 에이전트가 백업에 없고, 편집 방침은 공개 저장소로 갈 수 있어 싣지 않는다
          ...(r.home ? { home: true } : {}),
        },
      ]);
      return r.visibility === App.PUBLIC ? file : file.keptPrivate();
    });
  }

  /**
   * 앱마다 방문자에게 보이는 버전의 코드 (시작 코드를 쓰는 앱은 없다). 확인 대기 · 지난 버전은 싣지 않는다.
   * 디스크에 없는 파일은 사진처럼 빼고 로그를 남긴다 (복원이 묶음 규칙으로 다시 본다)
   */
  private async appCode(actor: Actor, apps: readonly AppRow[]): Promise<ArchiveFile[]> {
    const files: ArchiveFile[] = [];
    for (const app of apps) {
      if (app.code_seq === null) continue;
      const code = await this.code.filesOf(actor, app, app.code_seq);
      // 이름 순서로: 복원한 버전을 다시 내보내도 같은 차례가 되게
      const names = code.files
        .toJSON()
        .map((f) => f.name)
        .sort();
      for (const name of names) {
        try {
          const body = await buffer(await this.code.open(actor, code, name));
          const file = ArchiveFile.bytes(`blog/apps/${app.slug}/code/${name}`, body);
          files.push(app.visibility === App.PUBLIC ? file : file.keptPrivate());
        } catch (error) {
          if (!(error instanceof NotFound)) throw error;
          this.logger.warn(`디스크에 없어 앱 코드 파일을 뺐어요: ${app.slug}/${name}`);
        }
      }
    }
    return files;
  }

  private async posts(actor: Actor): Promise<ArchiveFile[]> {
    const rows = await this.sql<ArchivedPost[]>`
      SELECT p.id, p.slug, p.status, p.title, p.tags, p.align, p.main_wiki_id, p.published_at, p.meta,
             r.body_md, first.created_at AS first_at,
             (SELECT array_agg(x.wiki_id ORDER BY x.wiki_id) FROM blog.post_wiki_refs x WHERE x.post_id = p.id) AS refs,
             (SELECT array_agg(a.blob_hash ORDER BY a.blob_hash) FROM blog.assets a WHERE a.post_id = p.id) AS assets,
             p.app_id, g.visibility = ${App.PUBLIC} AS app_public
      FROM blog.posts p
      JOIN blog.post_revisions r ON r.id = p.head_revision_id
      LEFT JOIN blog.apps g ON g.id = p.app_id
      JOIN LATERAL (
        SELECT f.created_at FROM blog.post_revisions f WHERE f.post_id = p.id ORDER BY f.seq LIMIT 1
      ) first ON TRUE
      WHERE p.deleted_at IS NULL
        ${actor.spaceId === null ? this.sql`` : this.sql`AND p.space_id = ${actor.spaceId}`}
      ORDER BY p.id`;
    return rows.map((r) => {
      const year = (r.published_at ?? r.first_at).getUTCFullYear();
      const refs = r.refs ?? [];
      const file = ArchiveFile.markdown(
        `blog/posts/${year}/${r.slug}.md`,
        {
          cairn_format: ArchiveQuery.FORMAT,
          cairn_type: 'post',
          cairn_id: r.id,
          title: r.title,
          slug: r.slug,
          status: r.status,
          published: r.published_at,
          ...(r.app_id === null ? {} : { cairn_app: r.app_id }),
          ...(r.main_wiki_id === null ? {} : { cairn_main_wiki: r.main_wiki_id }),
          ...(refs.length === 0 ? {} : { cairn_ref_wikis: refs }),
          ...(r.tags.length === 0 ? {} : { tags: r.tags }),
          align: r.align,
          cairn_assets: r.assets ?? [],
        },
        r.body_md,
        ArchiveFile.keptIn(r.meta),
      );
      return r.status === Post.PUBLISHED && r.app_public ? file : file.keptPrivate();
    });
  }

  /**
   * 남은 글이 쓰는 사진과 앱 아이콘. 이름이 내용의 해시라 여러 곳에 쓰여도 한 번만.
   * 공개 앱의 공개 글이나 공개 앱의 아이콘으로 쓰인 것만 공개 저장소로 나간다
   */
  private async photos(actor: Actor, apps: readonly AppRow[]): Promise<ArchiveFile[]> {
    const rows = await this.sql<(Pick<AssetRow, 'blob_hash'> & { open: boolean })[]>`
      SELECT a.blob_hash, bool_or(p.status = ${Post.PUBLISHED} AND g.visibility = ${App.PUBLIC}) AS open
      FROM blog.assets a JOIN blog.posts p ON p.id = a.post_id
        LEFT JOIN blog.apps g ON g.id = p.app_id
      WHERE p.deleted_at IS NULL
        ${actor.spaceId === null ? this.sql`` : this.sql`AND p.space_id = ${actor.spaceId}`}
      GROUP BY a.blob_hash`;
    const open = new Map(rows.map((r) => [r.blob_hash, r.open === true]));
    for (const app of apps)
      if (app.icon_blob_hash !== null)
        open.set(
          app.icon_blob_hash,
          (open.get(app.icon_blob_hash) ?? false) || app.visibility === App.PUBLIC,
        );
    const files: ArchiveFile[] = [];
    for (const hash of [...open.keys()].sort()) {
      const file = await this.photo(hash);
      if (file) files.push(open.get(hash) ? file : file.keptPrivate());
    }
    return files;
  }

  /** 사진 하나. 디스크에 없는 파일 하나로 백업 전체를 막지 않는다: 빼고 로그를 남긴다 */
  private async photo(hash: string): Promise<ArchiveFile | null> {
    const blob = await this.blobs.find(hash);
    const extension = blob && ImagePolicy.EXTENSIONS[blob.mime];
    if (!extension) {
      this.logger.warn(`형식을 몰라 사진을 뺐어요: ${hash} (${blob?.mime ?? '정보 없음'})`);
      return null;
    }
    try {
      const body = await buffer(await this.blobs.open(hash));
      return ArchiveFile.bytes(`assets/${hash}.${extension}`, body);
    } catch (error) {
      if (!(error instanceof NotFound)) throw error;
      this.logger.warn(`디스크에 없어 사진을 뺐어요: ${hash}`);
      return null;
    }
  }
}
