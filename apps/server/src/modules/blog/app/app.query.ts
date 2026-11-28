import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  type Blob,
  BlobStore,
  Database,
  HostGate,
  NotFound,
  SecretBox,
  SettingActor,
  type SettingChangeInput,
} from '../../platform';
import { apps } from '../blog.schema';
import type { AppRow } from '../blog.tables';
import { App } from './app';
import type { AppSlugInput, DomainProofInput } from './app.input';
import {
  AppDomainListView,
  type AppListRow,
  AppListView,
  AppSettingsView,
  AppSettingView,
  AppView,
  PublicAppListView,
  PublicAppView,
} from './app.view';
import { AppDomainProof } from './app-domain.policy';

/** 앱 아이콘 파일 하나 (공개 앱이면 누구나: 방문자 첫 화면의 앱 목록) */
export class AppIconFile {
  /** 주소에 내용의 해시(v)가 붙어 바뀌면 주소도 바뀐다. 짧게만 둔다: v 없이 부른 주소가 오래 남지 않게 */
  readonly cacheControl = 'public, max-age=300';

  constructor(
    readonly blob: Blob,
    readonly stream: Readable,
  ) {}
}

/** 도메인 연결 확인 값 (GET /.well-known/moida-domain). 기본 도메인의 화면만 읽게 그 출처를 함께 준다 (CORS) */
export class AppDomainProofAnswer {
  constructor(
    private readonly token: string,
    /** 읽어도 되는 출처: 요청이 사이트 주소에서 왔을 때 그 출처. 아니면 null (아무 출처도 읽지 못한다) */
    readonly allowOrigin: string | null,
  ) {}

  toJSON() {
    return { token: this.token };
  }
}

// 앱 읽기 (스토어 1단계). 관리자는 모든 앱과 든 것의 수, 그 밖에는 공개 앱만 (비공개 앱은 없는 앱과 같은 404).
// 방문자는 공간을 모른다: MVP는 공간 하나라 방문자 읽기는 공간으로 거르지 않는다 (blog 규칙).
@Injectable()
export class AppQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly blobs: BlobStore,
    private readonly gate: HostGate,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  /** 순서대로. 관리자는 칸 전부와 공개 글 · 임시 글 · 메뉴 · 페이지의 수, 그 밖에는 공개 앱의 아이콘 목록 */
  async list(actor: Actor): Promise<AppListView | PublicAppListView> {
    if (actor.kind !== 'owner')
      return new PublicAppListView(
        await this.rows(apps, { visibility: App.PUBLIC }, { order: ['sort', 'created_at', 'id'] }),
      );
    const rows = await this.sql<AppListRow[]>`
      SELECT a.*,
        (SELECT count(*) FROM blog.posts p
         WHERE p.app_id = a.id AND p.deleted_at IS NULL AND p.status = 'published')::int AS published,
        (SELECT count(*) FROM blog.posts p
         WHERE p.app_id = a.id AND p.deleted_at IS NULL AND p.status = 'draft')::int AS drafts,
        (SELECT count(*) FROM blog.menus m WHERE m.app_id = a.id)::int AS menus,
        (SELECT count(*) FROM blog.pages g WHERE g.app_id = a.id)::int AS pages
      FROM blog.apps a WHERE a.space_id = ${actor.requireSpace()}
      ORDER BY a.sort, a.created_at, a.id`;
    return new AppListView(rows);
  }

  /** 주소로 앱 하나 (앱 첫 화면의 머리). 관리자는 비공개도, 그 밖에는 공개 앱만 */
  async bySlug(actor: Actor, req: AppSlugInput): Promise<AppView | PublicAppView> {
    const row = await this.shown(actor, req.slug);
    return actor.kind === 'owner' ? new AppView(row) : new PublicAppView(row);
  }

  /** 앱 아이콘. 아이콘이 없거나 볼 수 없는 앱이면 404 (화면은 종류의 선 아이콘을 그린다) */
  async icon(actor: Actor, req: AppSlugInput): Promise<AppIconFile> {
    const hash = (await this.shown(actor, req.slug)).icon_blob_hash;
    const blob = hash ? await this.blobs.find(hash) : null;
    if (!hash || !blob) throw new NotFound('아이콘이 없어요');
    return new AppIconFile(blob, await this.blobs.open(hash));
  }

  /**
   * 다른 모듈이 platform Lookups 'app'으로 묻는 앱 이름 (스토어 2단계: 대화의 앱). 관리자는 공간의 앱, 그 밖은 공개 앱만.
   * 볼 수 없거나 없는 앱은 빠진다. kind를 주면 그 종류의 앱만 (Lookups 'community-app', 스토어 3-1: 커뮤니티가 공개된 커뮤니티 앱인지 묻는다)
   */
  async names(
    actor: Actor,
    ids: readonly string[],
    kind: AppRow['kind'] | null = null,
  ): Promise<ReadonlyMap<string, string>> {
    const where =
      actor.kind === 'owner'
        ? this.sql`AND space_id = ${actor.requireSpace()}`
        : this.sql`AND visibility = ${App.PUBLIC}`;
    const ofKind = kind === null ? this.sql`` : this.sql`AND kind = ${kind}`;
    const rows = await this.sql<Pick<AppRow, 'id' | 'name'>[]>`
      SELECT id, name FROM blog.apps WHERE id = ANY(${ids as string[]}::uuid[]) ${where} ${ofKind}`;
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /**
   * 다른 곳이 platform Lookups 'app-url'로 묻는 공개 앱의 바깥 주소 (2026-11-26, 플러그인 email의 새 글 링크):
   * 확인한 도메인이면 https://<도메인>/, 아니면 /<주소> (PublicAppView의 url과 같은 규칙). 공개 앱만, 관리자도 같다
   */
  async urls(_actor: Actor, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const rows = await this.sql<Pick<AppRow, 'id' | 'slug' | 'domain' | 'domain_checked_at'>[]>`
      SELECT id, slug, domain, domain_checked_at FROM blog.apps
      WHERE id = ANY(${ids as string[]}::uuid[]) AND visibility = ${App.PUBLIC}`;
    return new Map(
      rows.map((r) => [
        r.id,
        r.domain && r.domain_checked_at
          ? `https://${r.domain}/`
          : `${this.gate.appsOrigin() ?? ''}/${r.slug}`,
      ]),
    );
  }

  /**
   * 다른 곳이 platform Lookups 'app-id'로 묻는 공개 앱의 id (2026-11-26, 플러그인 email의 구독 신청): 주소(slug) → id.
   * 방문자 응답에는 앱 id를 싣지 않아 화면은 주소로 가리킨다. 공개 앱만
   */
  async idsBySlug(_actor: Actor, slugs: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const rows = await this.sql<Pick<AppRow, 'id' | 'slug'>[]>`
      SELECT id, slug FROM blog.apps WHERE slug = ANY(${slugs as string[]}::text[]) AND visibility = ${App.PUBLIC}`;
    return new Map(rows.map((r) => [r.slug, r.id]));
  }

  /**
   * 대화에서 요청한 배포 전에 빠진 점 (platform ActionChecks, 2026-11-24 blog.app.publish): 없는 앱 · 도메인을 확인하지 않은 커뮤니티.
   * 요청한 에이전트의 공간에서 찾는다. 빠진 점이 없으면 null
   */
  async publishProblem(actor: Actor, appId: string): Promise<string | null> {
    const app = await this.row(apps, { space_id: actor.requireSpace(), id: appId });
    if (!app) return '없는 앱이에요';
    const shared = this.gate.appsHost() !== null;
    if (
      app.visibility !== App.PUBLIC &&
      app.kind === App.COMMUNITY &&
      !app.domain_checked_at &&
      !shared
    )
      return '커뮤니티는 도메인 연결을 확인한 뒤에 공개할 수 있어요 (앱 관리 › 설정의 도메인)';
    return null;
  }

  /**
   * 회원을 받는 앱 (Lookups 'member-app', 스토어 12.3): 커뮤니티 앱이거나 보이는 코드의 선언서에 members가 참인 앱.
   * 관리자는 공간의 그런 앱, 그 밖은 공개했고 도메인 연결을 확인한 앱만 (회원 가입 · 로그인은 앱 도메인에서만 된다).
   * 공통 앱 도메인이 있으면(2026-11-27) 모든 공개 앱이 그 도메인에서 회원을 받는다
   */
  async memberApps(actor: Actor, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const where =
      actor.kind === 'owner'
        ? this.sql`AND space_id = ${actor.requireSpace()}`
        : this.gate.appsHost() !== null
          ? this.sql`AND visibility = ${App.PUBLIC}`
          : this.sql`AND visibility = ${App.PUBLIC} AND domain_checked_at IS NOT NULL`;
    const rows = await this.sql<Pick<AppRow, 'id' | 'name'>[]>`
      SELECT id, name FROM blog.apps
      WHERE id = ANY(${ids as string[]}::uuid[]) ${where}
        AND (kind = ${App.COMMUNITY} OR code_manifest->>'members' = 'true')`;
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** 모든 앱의 도메인(확인 전 것까지) → [앱 id, 공간 id] (platform HostGate가 서버 자신으로 묻는다, 스토어 3-0) */
  async hosts(actor: Actor): Promise<{
    domains: ReadonlyMap<string, readonly [string, string]>;
    slugs: ReadonlyMap<string, readonly [string, string]>;
  }> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql<
      { domain: string | null; slug: string; id: string; space_id: string }[]
    >`
      SELECT domain, slug, id, space_id FROM blog.apps`;
    const place = (r: (typeof rows)[number]) => [r.id, r.space_id] as const;
    return {
      domains: new Map(rows.flatMap((r) => (r.domain ? [[r.domain, place(r)] as const] : []))),
      slugs: new Map(rows.map((r) => [r.slug, place(r)] as const)),
    };
  }

  /**
   * 도메인으로 여는 앱 (누구나, 웹이 Host로 앱을 고른다): 공개 앱 가운데 연결을 확인한 도메인만.
   * 확인 전 도메인 · 비공개 앱의 도메인은 없다 (그 도메인의 화면은 없는 주소와 같다).
   * 사이트 주소의 호스트는 앱 도메인으로 치지 않는다 (서버의 HostGate와 같은 규칙): 사이트 주소를 정하기 전에 같은 도메인을
   * 앱에 연결했어도, 웹이 콘솔(/admin) · 로그인까지 그 앱 안으로 넘겨 콘솔에 들어가지 못하게 되지 않게 (2026-11-25)
   */
  async domains(_actor: Actor): Promise<AppDomainListView> {
    const site = await this.gate.siteHost();
    const rows = await this.sql<Pick<AppRow, 'domain' | 'slug'>[]>`
      SELECT domain, slug FROM blog.apps
      WHERE visibility = ${App.PUBLIC} AND domain IS NOT NULL AND domain_checked_at IS NOT NULL
      ORDER BY domain`;
    return new AppDomainListView(rows.filter((r) => r.domain !== site));
  }

  /**
   * 도메인 연결 확인 값 (스토어 3-0): 앱 도메인으로 온 요청이면 그 도메인을 가진 앱의 값. 기본 도메인 · 모르는 도메인이면 404.
   * 비공개 앱의 도메인도 답한다: 공개하기 전에 연결을 확인하게. 값으로는 앱이 무엇인지 알 수 없다 (AppDomainProof).
   * 읽어도 되는 출처(CORS)는 요청이 사이트 주소에서 왔을 때만 싣는다 (2026-11-25): 누구나 앱 도메인에 GET 한 번으로
   * 그 앱을 올린 사이트(콘솔이 있는 곳)를 알아내지 못하게
   */
  async domainProof(_actor: Actor, req: DomainProofInput): Promise<AppDomainProofAnswer> {
    const row = req.host === null ? null : await this.row(apps, { domain: req.host });
    if (!row?.domain) throw new NotFound('없는 주소예요');
    const site = await this.gate.siteOrigin();
    return new AppDomainProofAnswer(
      new AppDomainProof(this.box).tokenOf(row.id, row.domain),
      site !== null && req.origin === site ? site : null,
    );
  }

  /** 대화로 바꾸는 앱 (get_settings apps). 확인을 거친 제안자만 */
  async settings(actor: Actor): Promise<AppSettingsView> {
    const spaceId = SettingActor.spaceOf(actor);
    return new AppSettingsView(
      await this.rows(apps, { space_id: spaceId }, { order: ['sort', 'created_at', 'id'] }),
    );
  }

  /** 제안의 지금 값. 만들기면 null */
  async settingNow(actor: Actor, change: SettingChangeInput): Promise<AppSettingView | null> {
    const spaceId = SettingActor.spaceOf(actor);
    if (change.targetId === null) return null;
    const row = await this.row(apps, { space_id: spaceId, id: change.targetId });
    if (!row) throw new NotFound('앱을 찾을 수 없어요');
    return new AppSettingView(row);
  }

  /** hashes 가운데 앱 아이콘이 가리키는 파일 (BlobStore.registerUse: 쓰는 동안 platform이 지우지 않게) */
  async usedBlobs(actor: Actor, hashes: readonly string[]): Promise<readonly string[]> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql<{ hash: string }[]>`
      SELECT icon_blob_hash AS hash FROM blog.apps
      WHERE icon_blob_hash = ANY(${hashes as string[]}::text[])`;
    return rows.map((row) => row.hash);
  }

  /** 요청자가 볼 수 있는 앱: 관리자는 자기 공간의 모든 앱, 그 밖에는 공개 앱만. 아니면 없는 앱과 같은 404 */
  private async shown(actor: Actor, slug: string): Promise<AppRow> {
    const row =
      actor.kind === 'owner'
        ? await this.row(apps, { space_id: actor.requireSpace(), slug })
        : await this.row(apps, { slug, visibility: App.PUBLIC });
    if (!row) throw new NotFound('앱을 찾을 수 없어요');
    return row;
  }
}
