import { Injectable } from '@nestjs/common';
import {
  type Actor,
  ApprovedActor,
  BaseService,
  Database,
  Forbidden,
  Lookups,
  MemberActor,
  NotFound,
  RuleViolation,
} from '../../platform';
import type { MemberPlace } from '../member/member.input';
import { MemberRepository } from '../member/member.repository';
import type {
  AdminRowInput,
  AdminRowsInput,
  DataEditInput,
  DataRowInput,
  DataWriteInput,
  TablesShownInput,
} from './app-data.input';
import { AppRowsAddedView, AppRowView } from './app-data.view';
import { AppTable } from './app-table';
import { AppTableRepository } from './app-table.repository';

// 앱 데이터 쓰기 (스토어 12.4).
// - 맞추기(apply): 보이는 버전의 선언대로 그 앱의 표를 만들고 정책을 건다 (일꾼, blog.app_code.shown). 두 번 받아도 같다.
// - 회원의 쓰기: 한 트랜잭션에서 회원 행을 잠가(같은 회원의 쓰기를 줄 세운다) 차단 · 한도를 본 뒤 역할 cairn_app으로 바꿔 쓴다.
//   자기 줄인지는 DB의 행 수준 보안이 본다: 남의 줄을 고치거나 지우면 바뀐 줄이 없어 404.
// - 관리자의 넣기 · 지우기는 역할을 바꾸지 않는다. 일꾼은 설정 제안(app_data)을 승인받은 ApprovedActor로만 넣는다 (원칙 7).
// 줄에는 엔티티가 없다 (칸을 앱이 정한다): 값은 AppTable.checked가 선언의 타입에 맞춘 것만 저장소로 간다
@Injectable()
export class AppDataService extends BaseService {
  /** 승인한 줄 넣기의 동작 이름 (설정 제안 app_data) */
  static readonly ADD_ACTION = 'community.app_data.add';
  private static readonly MISSING = '없는 표예요';

  constructor(
    db: Database,
    private readonly lookups: Lookups,
  ) {
    super(db);
  }

  /** 보이는 버전이 선언한 표에 맞춘다: 없는 표 · 칸을 더하고 규칙을 다시 걸고, 선언에서 빠진 표는 닫는다 */
  async apply(actor: Actor, req: TablesShownInput): Promise<void> {
    actor.assertOwnerOrSystem();
    const now = new Date();
    await this.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      await tables.lockApp(req.appId);
      const known = await tables.listOf(req.appId);
      for (const [name, spec] of Object.entries(req.tables)) {
        const before = known.find((t) => t.name === name);
        const table = before ?? AppTable.open(req.appId, name, spec, req.seq, now);
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

  /**
   * 관리자가 줄을 넣는다 (레슨 · 단어 같은 내용). 승인한 설정 제안(app_data)도 이 길이다: 그 동작의 ApprovedActor만.
   * 줄 하나라도 틀리면 아무것도 넣지 않는다. owner는 비운다
   */
  async addRows(actor: Actor, req: AdminRowsInput): Promise<AppRowsAddedView> {
    const approved = actor instanceof ApprovedActor && actor.action === AppDataService.ADD_ACTION;
    if (!approved) actor.assertOwner();
    await this.lookups.assertVisible('app', actor, [req.appId], '없는 앱이에요');
    const now = new Date();
    return this.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      const table = await tables.openOf(req.appId, req.table);
      if (!table) throw new NotFound(AppDataService.MISSING);
      const rows = req.rows.map((row) => table.checked(row));
      const [all] = await tables.countRows(table, null);
      if (all + rows.length > AppTable.ROWS_MAX) throw new RuleViolation('표가 가득 찼어요');
      for (const values of rows) await tables.insertRow(table, null, values, now);
      return new AppRowsAddedView(table.name, rows.length);
    });
  }

  /** 관리자가 줄 하나를 지운다 (누가 쓴 줄이든) */
  async removeRow(actor: Actor, req: AdminRowInput): Promise<void> {
    actor.assertOwner();
    await this.lookups.assertVisible('app', actor, [req.appId], '없는 앱이에요');
    await this.transaction(async (tx) => {
      const tables = new AppTableRepository(tx);
      const table = await tables.openOf(req.appId, req.table);
      if (!table) throw new NotFound(AppDataService.MISSING);
      if ((await tables.deleteRow(table, req.id)) === 0) throw new NotFound('없는 줄이에요');
    });
  }

  private assertApp(actor: Actor, place: MemberPlace): Promise<void> {
    return this.lookups.assertVisible('app', actor, [place.appId], '없는 주소예요');
  }
}
