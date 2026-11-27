import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  Database,
  Lookups,
  MemberActor,
  NotFound,
  SettingActor,
  ZipFile,
} from '../../platform';
import { appTables } from '../community.schema';
import type { MemberPlace } from '../member/member.input';
import type { AdminAppInput, AdminDataInput, DataListInput } from './app-data.input';
import { AppDataSettingsView, AppRowsView, AppTablesView } from './app-data.view';
import { type AppDataFilter, AppTable } from './app-table';
import { AppTableRepository } from './app-table.repository';

/** 앱 하나를 내보낸 묶음 (관리자의 내려받기) */
export class AppDataExport {
  constructor(
    readonly fileName: string,
    readonly bytes: Buffer,
  ) {}
}

// 앱 데이터 읽기 (스토어 12.4). 회원 쪽(앱 도메인): 공개 앱의 열려 있는 표를 역할 cairn_app으로 읽는다 —
// 읽기 규칙(anyone · member · owner)은 DB의 행 수준 보안이 거른다. 관리자(기본 도메인): 공간의 앱의 표 목록 · 줄 · 내보내기.
// 표 · 칸 이름은 선언 목록(AppTable)에서 온 것만 SQL에 쓴다
@Injectable()
export class AppDataQuery extends BaseQuery {
  private static readonly MISSING = '없는 표예요';

  constructor(
    db: Database,
    private readonly lookups: Lookups,
  ) {
    super(db);
  }

  /** 줄 목록 (회원 쪽). 읽지 못하는 표 · 닫힌 표는 없는 표와 같다 */
  async list(actor: Actor, place: MemberPlace, req: DataListInput): Promise<AppRowsView> {
    await this.lookups.assertVisible('app', actor, [place.appId], '없는 주소예요');
    const memberId = actor instanceof MemberActor && actor.appId === place.appId ? actor.id : null;
    return this.db.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      const table = await tables.openOf(place.appId, req.table);
      if (!table?.memberReadable) throw new NotFound(AppDataQuery.MISSING);
      const filters = AppDataQuery.filtersOf(table, req, memberId);
      await tables.asMember(memberId);
      const rows = await tables.readRows(table, filters, req.order, req.limit, req.offset);
      return new AppRowsView(rows.slice(0, req.limit), rows.length > req.limit, memberId);
    });
  }

  /**
   * 앱마다 남아 있는 회원 (lookup `app-members`, 2026-11-23 앱 지우기 막기): 앱 id → "회원 N명". 없는 앱은 빠진다.
   * 관리자만 (blog가 앱을 지우기 전에 묻는다). 회원이 있으면 앱을 지우지 않는다 (탈퇴는 회원이 한다)
   */
  async heldMembers(actor: Actor, appIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const ids = await this.ownedApps(actor, appIds);
    if (ids.length === 0) return new Map();
    const counted = await this.sql<{ app_id: string; n: string }[]>`
      SELECT app_id, count(*) AS n FROM community.members WHERE app_id = ANY(${ids}) GROUP BY app_id`;
    return new Map(counted.map((r) => [r.app_id, `회원 ${Number(r.n)}명`]));
  }

  /**
   * 앱마다 남아 있는 앱 데이터 (lookup `app-rows`): 앱 id → "앱 데이터 M줄". 줄이 없는 앱은 빠진다.
   * 관리자만. 줄 수는 표마다 ROWS_MAX를 넘으면 그 수에서 멈춘다. blog는 "함께 지우기"(withData) 없이는 이 앱을 지우지 않는다 (2026-11-27)
   */
  async heldRows(actor: Actor, appIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const ids = await this.ownedApps(actor, appIds);
    if (ids.length === 0) return new Map();
    return this.db.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      const held = new Map<string, string>();
      for (const id of ids) {
        let rows = 0;
        for (const table of await tables.listOf(id))
          rows += (await tables.countRows(table, null))[0];
        if (rows > 0) held.set(id, `앱 데이터 ${rows}줄`);
      }
      return held;
    });
  }

  private async ownedApps(actor: Actor, appIds: readonly string[]): Promise<string[]> {
    actor.assertOwner();
    const visible = await this.lookups.visible('app', actor, appIds);
    return appIds.filter((id) => visible.has(id));
  }

  /** 관리자: 앱의 표 목록 (닫힌 것까지) */
  async tables(actor: Actor, req: AdminAppInput): Promise<AppTablesView> {
    await this.assertOwned(actor, req.appId);
    return this.db.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      const listed = [];
      for (const table of await tables.listOf(req.appId))
        listed.push(table.listed((await tables.countRows(table, null))[0]));
      return new AppTablesView(listed);
    });
  }

  /** 관리자: 표 하나의 줄 (모든 줄, 쓴 회원 id까지) */
  async adminRows(actor: Actor, req: AdminDataInput): Promise<AppRowsView> {
    await this.assertOwned(actor, req.appId);
    return this.db.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      const table = await tables.openOf(req.appId, req.list.table);
      if (!table) throw new NotFound(AppDataQuery.MISSING);
      const { order, limit, offset } = req.list;
      const filters = AppDataQuery.filtersOf(table, req.list, null);
      const rows = await tables.readRows(table, filters, order, limit, offset);
      return new AppRowsView(rows.slice(0, limit), rows.length > limit, null, true);
    });
  }

  /**
   * 관리자: 앱의 데이터와 회원을 한 묶음으로 (스토어 12.5). tables.json(선언) · schema.sql(CREATE TABLE) · data.sql(INSERT) ·
   * members.json(아이디 · 닉네임 · 비밀번호 해시 · 가입한 때 · 동의한 약관 버전 · 탈퇴한 때) · terms/<종류>-v<버전>.md(약관의 모든 버전, 3-4).
   * schema.sql · data.sql은 어느 Postgres에나 들어간다. 탈퇴한 회원은 지운 값(left:<id>) 그대로 실린다
   */
  async export(actor: Actor, req: AdminAppInput, now: Date): Promise<AppDataExport> {
    await this.assertOwned(actor, req.appId);
    const zip = new ZipFile();
    await this.db.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      const listed = await tables.listOf(req.appId);
      const schema: string[] = [];
      const data: string[] = [];
      for (const table of listed) {
        const columns = Object.entries(table.columns)
          .map(([name, type]) => `  "${name}" ${AppTable.SQL_TYPES[type]}`)
          .join(',\n');
        schema.push(
          `CREATE TABLE "${table.name}" (\n  id uuid PRIMARY KEY,\n  owner uuid,\n  created_at timestamptz NOT NULL,\n  updated_at timestamptz NOT NULL,\n${columns}\n);`,
        );
        data.push(`-- ${table.name}`, ...(await tables.dumpRows(table)));
      }
      const declared = Object.fromEntries(
        listed.map((t) => [
          t.name,
          { columns: t.columns, read: t.readRule, write: t.writeRule, open: t.isOpen },
        ]),
      );
      zip.add('tables.json', JSON.stringify(declared, null, 2));
      zip.add('schema.sql', `${schema.join('\n\n')}\n`);
      zip.add('data.sql', `${data.join('\n')}\n`);
    });
    const members = await this.sql<Record<string, unknown>[]>`
      SELECT m.id, m.account_id, a.login_id, a.email, m.nickname, a.password_hash, m.joined_at,
             m.blocked_until, m.terms_version AS app_terms_version, m.privacy_version AS app_privacy_version,
             a.terms_version, a.privacy_version, m.left_at
      FROM community.members m LEFT JOIN community.accounts a ON a.id = m.account_id
      WHERE m.app_id = ${req.appId} ORDER BY m.id`;
    zip.add('members.json', JSON.stringify({ members }, null, 2));
    // 약관은 모든 버전 (스토어 3-4): 회원마다 동의한 버전(terms_version · privacy_version)을 맞춰 볼 수 있게
    const terms = await this.sql<
      { kind: string; version: number; body: string; created_at: Date }[]
    >`
      SELECT kind, version, body, created_at FROM community.terms
      WHERE app_id = ${req.appId} ORDER BY kind, version`;
    for (const t of terms)
      zip.add(
        `terms/${t.kind}-v${t.version}.md`,
        `<!-- ${t.kind} 버전 ${t.version} · ${t.created_at.toISOString()} -->\n\n${t.body}\n`,
      );
    return new AppDataExport(`app-data-${now.toISOString().slice(0, 10)}.zip`, zip.toBuffer());
  }

  /** 대화의 get_settings app_data: 이 공간의 열려 있는 표와 칸 · 규칙 (줄을 넣자고 제안할 곳) */
  async settings(actor: Actor): Promise<AppDataSettingsView> {
    const spaceId = SettingActor.spaceOf(actor);
    const rows = await this.rows(
      appTables,
      { space_id: spaceId, open: true },
      { order: ['app_id', 'name'] },
    );
    return new AppDataSettingsView(rows);
  }

  /** 관리자만, 공간의 앱만 (아니면 404) */
  private async assertOwned(actor: Actor, appId: string): Promise<void> {
    actor.assertOwner();
    await this.lookups.assertVisible('app', actor, [appId], '없는 앱이에요');
  }

  /** 요청의 조건을 표의 선언으로 읽는다. owner의 값 me는 지금 회원 (로그인하지 않았으면 아무 줄도 맞지 않는다) */
  private static filtersOf(
    table: AppTable,
    req: DataListInput,
    memberId: string | null,
  ): AppDataFilter[] {
    table.assertSortable(req.order[0]);
    const none = '00000000-0000-0000-0000-000000000000';
    return [...req.filters].map(([column, expression]) =>
      table.filterOf(
        column,
        column === 'owner' ? expression.replace(/\.me$/, `.${memberId ?? none}`) : expression,
      ),
    );
  }
}
