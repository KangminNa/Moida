import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  Database,
  Lookups,
  NotFound,
  SettingActor,
  type SettingChangeInput,
} from '../../platform';
import type { StorePlace } from '../account/account.input';
import { terms } from '../community.schema';
import { TERM_KIND, type TermKind, type TermRow } from '../community.tables';
import type { MemberPlace } from '../member/member.input';
import { TermsAdminLineView, TermsAdminView, TermsSettingView, TermView } from './terms.view';
import { TermsChange } from './terms-change';
import { TermsDraftGateway } from './terms-draft.gateway';

// 약관 읽기 (스토어 3-4). 공개된 약관은 마지막 버전이다. 공간(스토어)의 공통 약관과 앱의 약관이 있다 (2026-11-26)
// - 회원 화면(/_/terms · /_/privacy): 그 앱 도메인으로 온 요청, 회원을 받는 공개 앱이면 누구나 (Lookups 'member-app')
// - 관리 화면: 관리자만, 공통 약관 · 앱마다 둘의 지금 버전 + 처음 쓸 때의 초안
// - 가입 · 앱 참여: 지금 버전 둘 (TermsConsent가 동의한 버전과 맞춰 본다)
@Injectable()
export class TermsQuery extends BaseQuery {
  /** 공통 약관 초안에 넣는 이름 (앱 이름 대신) */
  private static readonly STORE_NAME = '이 사이트';

  constructor(
    db: Database,
    private readonly lookups: Lookups,
    private readonly drafts: TermsDraftGateway,
  ) {
    super(db);
  }

  /** 회원 화면의 약관 하나 (store면 공통 약관). 아직 없으면 404 */
  async published(
    actor: Actor,
    place: MemberPlace,
    kind: TermKind,
    store: boolean,
  ): Promise<TermView> {
    await this.lookups.assertVisible('member-app', actor, [place.appId], '없는 주소예요');
    const owner = store ? { spaceId: place.spaceId } : { appId: place.appId };
    const row = await this.latestRow(owner, kind);
    if (!row) throw new NotFound('아직 공개된 약관이 없어요');
    return new TermView(row);
  }

  /** 스토어 가입 화면(기본 도메인)의 공통 약관 (2026-11-26). 없으면 404 */
  async storePublished(_actor: Actor, place: StorePlace, kind: TermKind): Promise<TermView> {
    const row = await this.latestRow({ spaceId: place.spaceId }, kind);
    if (!row) throw new NotFound('아직 공개된 약관이 없어요');
    return new TermView(row);
  }

  /** 관리 화면: 이용약관 · 개인정보처리방침의 지금 버전과 초안 (앱 이름을 넣은). appId가 null이면 공간의 공통 약관 */
  async admin(actor: Actor, appId: string | null): Promise<TermsAdminView> {
    actor.assertOwner();
    let name = TermsQuery.STORE_NAME;
    if (appId !== null) {
      const found = (await this.lookups.visible('app', actor, [appId])).get(appId);
      if (found === undefined) throw new NotFound('없는 앱이에요');
      name = found;
    }
    const owner = appId === null ? { spaceId: actor.requireSpace() } : { appId };
    const lines = await Promise.all(
      TERM_KIND.map(async (kind) => {
        const row = await this.latestRow(owner, kind);
        return new TermsAdminLineView(
          kind,
          row ? new TermView(row) : null,
          this.drafts.draft(kind, name),
        );
      }),
    );
    return new TermsAdminView(lines);
  }

  /**
   * 가입 · 참여할 때 맞춰 볼 지금 버전 둘 (없으면 null). owner가 { spaceId }면 공통 약관.
   * 앱 확인은 부르는 쪽이 했다 (가입 · 참여는 앱 도메인에서만)
   */
  async versions(
    _actor: Actor,
    owner: { appId: string } | { spaceId: string },
  ): Promise<ReadonlyMap<TermKind, number | null>> {
    const where =
      'appId' in owner
        ? this.sql`app_id = ${owner.appId}`
        : this.sql`app_id IS NULL AND space_id = ${owner.spaceId}`;
    const rows = await this.sql<Pick<TermRow, 'kind' | 'version'>[]>`
      SELECT kind, max(version)::int AS version FROM community.terms
      WHERE ${where} GROUP BY kind`;
    return new Map(TERM_KIND.map((k) => [k, rows.find((r) => r.kind === k)?.version ?? null]));
  }

  /** get_settings terms: 일꾼이 제안하기 전에 읽는 앱 · 종류마다 지금 버전 */
  async settings(actor: Actor): Promise<TermsSettingView> {
    SettingActor.spaceOf(actor);
    const rows = await this.sql<Pick<TermRow, 'app_id' | 'kind' | 'version' | 'created_at'>[]>`
      SELECT DISTINCT ON (app_id, kind) app_id, kind, version, created_at FROM community.terms
      WHERE app_id IS NOT NULL ORDER BY app_id, kind, version DESC`;
    const ids = [...new Set(rows.map((r) => r.app_id ?? ''))];
    const apps = await this.lookups.visible('app', actor, ids);
    return new TermsSettingView(rows.filter((r) => apps.has(r.app_id ?? '')));
  }

  /** 제안의 지금 값 (바뀐 점 줄 · 승인 뒤 적용의 낡음 확인): 그 앱 · 종류의 지금 본문. 없으면 null */
  async settingNow(
    actor: Actor,
    change: SettingChangeInput,
  ): Promise<Record<string, unknown> | null> {
    SettingActor.spaceOf(actor);
    const proposed = TermsChange.of(change);
    const row = await this.latestRow({ appId: proposed.appId }, proposed.kind);
    return row ? { app_id: row.app_id, kind: row.kind, body: row.body } : null;
  }

  private latestRow(
    owner: { appId: string } | { spaceId: string },
    kind: TermKind,
  ): Promise<TermRow | null> {
    const where =
      'appId' in owner
        ? { app_id: owner.appId, kind }
        : { app_id: null, space_id: owner.spaceId, kind };
    return this.row(terms, where, { order: ['version desc'], limit: 1 });
  }
}
