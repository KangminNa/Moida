import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseService,
  Database,
  Forbidden,
  Lookups,
  MemberActor,
  NotFound,
  RuleViolation,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type SettingShape,
  type Sql,
} from '../../platform';
import type { MemberPlace } from '../member/member.input';
import { MemberRepository } from '../member/member.repository';
import {
  type AdminRowInput,
  AdminRowsInput,
  type DataEditInput,
  type DataRowInput,
  type DataWriteInput,
  type TablesShownInput,
} from './app-data.input';
import { AppRowsAddedView, AppRowView } from './app-data.view';
import { AppTable } from './app-table';
import { AppTableRepository } from './app-table.repository';

// 앱 데이터 쓰기 (스토어 12.4).
// - 맞추기(apply): 보이는 버전의 선언대로 그 앱의 표를 만들고 정책을 건다 (일꾼, blog.app_code.shown). 두 번 받아도 같다.
// - 회원의 쓰기: 한 트랜잭션에서 회원 행을 잠가(같은 회원의 쓰기를 줄 세운다) 차단 · 한도를 본 뒤 역할 cairn_app으로 바꿔 쓴다.
//   자기 줄인지는 DB의 행 수준 보안이 본다: 남의 줄을 고치거나 지우면 바뀐 줄이 없어 404.
// - 관리자의 넣기 · 지우기는 역할을 바꾸지 않는다. 일꾼은 대화의 설정 제안(app_data)으로 올리고 승인 뒤에 들어간다 (원칙 7).
// 줄에는 엔티티가 없다 (칸을 앱이 정한다): 값은 AppTable.checked가 선언의 타입에 맞춘 것만 저장소로 간다
@Injectable()
export class AppDataService extends BaseService {
  /** 대화로 표에 줄을 넣는 제안 (get_settings의 app_data · propose_setting의 app_data, 만들기만) */
  static readonly SETTING: SettingShape = {
    setting: 'app_data',
    list: 'app_data',
    ops: ['create'],
    fields: ['app_id', 'table', 'rows'],
    target: 'id',
    versioned: false,
    grants: 'all',
  };
  private static readonly MISSING = '없는 표예요';

  constructor(
    db: Database,
    private readonly lookups: Lookups,
  ) {
    super(db);
  }

  /** 보이는 버전이 선언한 표에 맞춘다: 없는 표 · 칸을 더하고 규칙을 다시 걸고, 선언에서 빠진 표는 닫는다 */
  async apply(actor: Actor, spaceId: string, req: TablesShownInput): Promise<void> {
    actor.assertOwnerOrSystem();
    const now = new Date();
    await this.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      await tables.lockApp(req.appId);
      const known = await tables.listOf(req.appId);
      for (const [name, spec] of Object.entries(req.tables)) {
        const before = known.find((t) => t.name === name);
        const table = before ?? AppTable.open(spaceId, req.appId, name, spec, req.seq, now);
        if (before) before.declare(spec, req.seq, now);
        await tables.ensure(table);
        await tables.save(table);
      }
      for (const table of known) {
        if (table.name in req.tables) continue;
        table.close(req.seq, now);
        await tables.save(table);
      }
    });
  }

  /** 회원이 줄을 만든다 (쓰기 규칙 member · owner). owner는 그 회원 */
  async insert(actor: Actor, place: MemberPlace, req: DataWriteInput): Promise<AppRowView> {
    const me = MemberActor.require(actor, place.appId);
    await this.assertApp(actor, place);
    const now = new Date();
    return this.transaction(async (tx) => {
      const member = await new MemberRepository(tx).lock(place.appId, me.id ?? '');
      member.assertActive(now);
      const tables = new AppTableRepository(tx);
      const table = await tables.openOf(place.appId, req.table);
      if (!table?.memberInserts) throw new NotFound(AppDataService.MISSING);
      const values = table.checked(req.values);
      const [all, own] = await tables.countRows(table, member.id);
      if (all >= AppTable.ROWS_MAX) throw new RuleViolation('표가 가득 찼어요');
      if (own >= AppTable.ROWS_PER_MEMBER)
        throw new RuleViolation(`한 회원은 이 표에 ${AppTable.ROWS_PER_MEMBER}줄까지 둘 수 있어요`);
      await tables.asMember(member.id);
      return new AppRowView(await tables.insertRow(table, member.id, values, now), member.id);
    });
  }

  /** 회원이 자기 줄을 고친다 (쓰기 규칙 owner). 남의 줄 · 없는 줄은 404 */
  async update(actor: Actor, place: MemberPlace, req: DataEditInput): Promise<AppRowView> {
    const me = MemberActor.require(actor, place.appId);
    await this.assertApp(actor, place);
    const now = new Date();
    return this.transaction(async (tx) => {
      const member = await new MemberRepository(tx).lock(place.appId, me.id ?? '');
      member.assertActive(now);
      const tables = new AppTableRepository(tx);
      const table = await tables.openOf(place.appId, req.table);
      if (!table?.memberInserts) throw new NotFound(AppDataService.MISSING);
      if (!table.memberEdits) throw new Forbidden('data', '고칠 수 없는 표예요');
      const values = table.checked(req.values);
      await tables.asMember(member.id);
      if ((await tables.updateRow(table, req.id, values, now)) === 0)
        throw new NotFound('없는 줄이에요');
      const row = await tables.readRow(table, req.id);
      return new AppRowView(row ?? { id: req.id, owner: member.id, ...values }, member.id);
    });
  }

  /** 회원이 자기 줄을 지운다 (쓰기 규칙 owner). 차단 중이어도 자기 줄은 지울 수 있다 */
  async delete(actor: Actor, place: MemberPlace, req: DataRowInput): Promise<void> {
    const me = MemberActor.require(actor, place.appId);
    await this.assertApp(actor, place);
    await this.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      const table = await tables.openOf(place.appId, req.table);
      if (!table?.memberInserts) throw new NotFound(AppDataService.MISSING);
      if (!table.memberEdits) throw new Forbidden('data', '지울 수 없는 표예요');
      await tables.asMember(me.id);
      if ((await tables.deleteRow(table, req.id)) === 0) throw new NotFound('없는 줄이에요');
    });
  }

  /** 관리자가 줄을 넣는다 (레슨 · 단어 같은 내용). 줄 하나라도 틀리면 아무것도 넣지 않는다. owner는 비운다 */
  async addRows(actor: Actor, req: AdminRowsInput): Promise<AppRowsAddedView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction((tx) => AppDataService.add(tx, spaceId, req, new Date(), true));
  }

  /** 대화의 제안(app_data)을 저장하지 않고 지나 본다: 그 공간의 열린 표인지 · 줄의 값이 선언에 맞는지 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    const req = AppDataService.rowsOf(change);
    await this.transaction((tx) => AppDataService.add(tx, spaceId, req, new Date(), false));
  }

  /**
   * 승인한 제안(app_data): 결재마다 한 번 줄을 넣고 결과(community.setting.changed)를 남긴다 (원칙 7: 방문자에게 보이는
   * 내용을 일꾼이 바로 바꾸지 않는다). 그사이 표가 닫혔거나 값이 맞지 않게 됐으면 실패로 끝난다
   */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    const req = AppDataService.rowsOf(change);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingOutcome.topicOf('community'),
      spaceId,
      change.key,
      async (tx) => {
        await AppDataService.add(tx, spaceId, req, new Date(), true);
      },
    );
  }

  /** 제안의 본문 { app_id, table, rows } → 넣을 줄 */
  private static rowsOf(change: SettingChangeInput): AdminRowsInput {
    const { app_id: appId, table, rows } = change.body;
    return AdminRowsInput.from(String(appId ?? ''), String(table ?? ''), { rows });
  }

  /** 그 공간의 열린 표에 줄을 넣는다 (write가 거짓이면 검사만). 다른 공간의 표는 없는 표와 같다 */
  private static async add(
    tx: Sql,
    spaceId: string,
    req: AdminRowsInput,
    now: Date,
    write: boolean,
  ): Promise<AppRowsAddedView> {
    const tables = new AppTableRepository(tx);
    const table = await tables.openOf(req.appId, req.table);
    if (!table?.inSpace(spaceId)) throw new NotFound(AppDataService.MISSING);
    const rows = req.rows.map((row) => table.checked(row));
    const [all] = await tables.countRows(table, null);
    if (all + rows.length > AppTable.ROWS_MAX) throw new RuleViolation('표가 가득 찼어요');
    if (write) for (const values of rows) await tables.insertRow(table, null, values, now);
    return new AppRowsAddedView(table.name, rows.length);
  }

  /** 관리자가 줄 하나를 지운다 (누가 쓴 줄이든) */
  async removeRow(actor: Actor, req: AdminRowInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      const table = await tables.openOf(req.appId, req.table);
      if (!table?.inSpace(spaceId)) throw new NotFound(AppDataService.MISSING);
      if ((await tables.deleteRow(table, req.id)) === 0) throw new NotFound('없는 줄이에요');
    });
  }

  private assertApp(actor: Actor, place: MemberPlace): Promise<void> {
    return this.lookups.assertVisible('app', actor, [place.appId], '없는 주소예요');
  }
}
