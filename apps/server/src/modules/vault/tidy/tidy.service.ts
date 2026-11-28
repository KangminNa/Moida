import { Injectable } from '@nestjs/common';
import {
  Actor,
  Database,
  EntityService,
  Leases,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
} from '../../platform';
import { SessionRepository } from '../session/session.repository';
import type { FlowEventInput, SaveTidySettingsInput, SessionSavedInput } from './tidy.input';
import { TidyQuery } from './tidy.query';
import { TidyBacklogView, type TidySettingsView } from './tidy.view';
import { TidyEdit } from './tidy-edit';
import type { TidySessionRow, TidySettings } from './tidy-settings';
import { TidySettingsRepository } from './tidy-settings.repository';

// 세션 정리 쓰기: 자동 정리 켜고 끄기(주인, 대화에서 제안한 것의 승인도 2026-11-15 D), 저장 뒤 자동 요청(일꾼), 쌓인 세션 요청(주인).
// 일을 직접 만들지 않는다: 일 요청 이벤트를 outbox에 남기고, 같은 판은 requestId로 작업 하나가 된다.
// 요청한 판은 같은 트랜잭션에서 세션에 적는다 (`tidy_requested_seq`). 이미 적힌 판은 다시 요청하지 않는다.
@Injectable()
export class TidyService extends EntityService<TidySettings> {
  constructor(
    db: Database,
    private readonly query: TidyQuery,
    private readonly leases: Leases,
  ) {
    super(db);
  }

  protected store(tx: Sql): TidySettingsRepository {
    return new TidySettingsRepository(tx);
  }

  /** 설정은 공간마다 하나라 대상의 id가 공간 id다. 행이 없을 때의 version은 0이다 */
  async save(actor: Actor, req: SaveTidySettingsInput): Promise<TidySettingsView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const target = { id: spaceId, version: req.version };
    const settings = await this.change(spaceId, target, (found) =>
      found.turn(req.autoTidy, req.cadence, new Date()),
    );
    return settings.view();
  }

  /** 설정 바꾸기 제안의 미리 해 보기 (2026-11-15 D): 같은 줄(TidyEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await new TidyEdit(tx, spaceId).apply(change, new Date());
    });
  }

  /** 승인한 설정 바꾸기: 결재마다 한 번 적용하고 결과(vault.setting.changed)를 남긴다 */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingOutcome.topicOf('vault'),
      spaceId,
      change.key,
      async (tx) => {
        await new TidySettingsRepository(tx).save(
          await new TidyEdit(tx, spaceId).apply(change, new Date()),
        );
      },
    );
  }

  /** 세션의 새 판이 저장된 뒤 (일꾼이 부른다). 꺼져 있으면 아무 일도 없다 */
  async saved(actor: Actor, spaceId: string, req: SessionSavedInput): Promise<void> {
    actor.assertCan(Actor.TIDY);
    const session = await this.query.session(actor, spaceId, req.sessionId);
    if (!session) return;
    await this.transaction(async (tx) => {
      const settings = new TidySettingsRepository(tx);
      const found = await settings.lock(spaceId);
      // 하루 한 번이면 여기서는 요청하지 않는다: 일꾼(TidyDailyJob)이 하루치 판을 한 번에 맡긴다
      if (!found.autoTidy || found.daily) return;
      if (!(await new SessionRepository(tx).noteTidyRequested(session.node_id, req.seq))) return;
      found.sessionSaved(session, req.seq);
      await settings.save(found);
    });
  }

  /**
   * 작업 세션의 요청이 끝났을지 모를 때 (S2, FlowSettledHandler): task에 묻고(트랜잭션 밖, platform Leases.settled)
   * 끝났으면 그 세션의 지금 판까지를 정리할 판(settled_seq)으로 적고, 저장마다 정리하면 바로 요청한다 (하루 한 번이면 그 차례에).
   * 버린 요청(취소 · 실패 · 결과 카드 반려)은 적지 않는다: 그 판은 다음에 끝나는 요청이 없으면 원문으로만 남는다.
   * 잠그는 순서는 설정 → 세션
   */
  async flowEnded(actor: Actor, spaceId: string, req: FlowEventInput): Promise<void> {
    actor.assertCan(Actor.TIDY);
    if (req.id === null) return;
    const settled = await this.leases.settled(actor, spaceId, req.id, req.card);
    if (!settled?.done) return;
    await this.transaction(async (tx) => {
      const settings = new TidySettingsRepository(tx);
      const found = await settings.lock(spaceId);
      const sessions = new SessionRepository(tx);
      const session = await sessions.settleFlow(spaceId, settled.flow);
      if (!session || !found.autoTidy || found.daily) return;
      if (!(await sessions.noteTidyRequested(session.node_id, session.revision_count))) return;
      found.sessionSaved(session, session.revision_count);
      await settings.save(found);
    });
  }

  /**
   * 하루 한 번의 차례 (일꾼, 2차 7단계): 새 판이 쌓인 세션을 한 묶음 요청하고 차례를 적는다.
   * 두 번 돌아도 같다: 설정을 잠근 뒤 차례인지 다시 보고, 세션마다 먼저 적은 쪽만 요청한다
   */
  async daily(actor: Actor, spaceId: string): Promise<number> {
    actor.assertOwnerOrSystem();
    const page = await this.query.daily(actor, spaceId);
    return this.transaction(async (tx) => {
      const settings = new TidySettingsRepository(tx);
      const sessions = new SessionRepository(tx);
      const found = await settings.lock(spaceId);
      const now = new Date();
      if (!found.dueDaily(now)) return 0;
      const fresh: TidySessionRow[] = [];
      for (const session of page)
        if (await sessions.noteTidyRequested(session.node_id, session.revision_count))
          fresh.push(session);
      found.ranDaily(fresh, now);
      await settings.save(found);
      return fresh.length;
    });
  }

  /**
   * 지금 판의 정리를 요청하지 않은 세션을 오래된 순으로 한 묶음 요청한다. 다시 누르면 다음 묶음으로 넘어간다.
   * 동시에 눌러도 세션마다 먼저 적은 쪽만 요청한다. 잠그는 순서는 설정 → 세션(id 순).
   */
  async backlog(actor: Actor): Promise<TidyBacklogView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const page = await this.query.backlog(actor);
    const requested = await this.transaction(async (tx) => {
      const settings = new TidySettingsRepository(tx);
      const sessions = new SessionRepository(tx);
      const found = await settings.lock(spaceId);
      const fresh: TidySessionRow[] = [];
      for (const session of page)
        if (await sessions.noteTidyRequested(session.node_id, session.revision_count))
          fresh.push(session);
      found.backlog(fresh);
      await settings.save(found);
      return fresh.length;
    });
    return new TidyBacklogView(requested, await this.query.remaining(actor));
  }
}
