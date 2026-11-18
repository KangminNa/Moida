import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  type Blob,
  BlobStore,
  Database,
  NotFound,
  SettingActor,
  type SettingChangeInput,
} from '../../platform';
import { apps } from '../blog.schema';
import type { AppRow } from '../blog.tables';
import { App } from './app';
import type { AppSlugInput } from './app.input';
import {
  type AppListRow,
  AppListView,
  AppSettingsView,
  AppSettingView,
  AppView,
  PublicAppListView,
  PublicAppView,
} from './app.view';

/** 앱 아이콘 파일 하나 (공개 앱이면 누구나: 방문자 첫 화면의 앱 목록) */
export class AppIconFile {
  /** 주소에 내용의 해시(v)가 붙어 바뀌면 주소도 바뀐다. 짧게만 둔다: v 없이 부른 주소가 오래 남지 않게 */
  readonly cacheControl = 'public, max-age=300';

  constructor(
    readonly blob: Blob,
    readonly stream: Readable,
  ) {}
}

// 앱 읽기 (스토어 1단계). 관리자는 모든 앱과 든 것의 수, 그 밖에는 공개 앱만 (비공개 앱은 없는 앱과 같은 404).
// 방문자는 공간을 모른다: MVP는 공간 하나라 방문자 읽기는 공간으로 거르지 않는다 (blog 규칙).
@Injectable()
export class AppQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly blobs: BlobStore,
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
   * 볼 수 없거나 없는 앱은 빠진다
   */
  async names(actor: Actor, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const where =
      actor.kind === 'owner'
        ? this.sql`AND space_id = ${actor.requireSpace()}`
        : this.sql`AND visibility = ${App.PUBLIC}`;
    const rows = await this.sql<Pick<AppRow, 'id' | 'name'>[]>`
      SELECT id, name FROM blog.apps WHERE id = ANY(${ids as string[]}::uuid[]) ${where}`;
    return new Map(rows.map((r) => [r.id, r.name]));
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
