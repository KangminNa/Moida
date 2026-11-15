import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseQuery,
  Database,
  Forbidden,
  NotFound,
  SettingActor,
  SettingCatalogView,
  type SettingChangeInput,
  SettingKinds,
  type ToolAnswer,
} from '../../platform';
import { Approval } from '../approval/approval';
import { agents, schedules } from '../task.schema';
import type { GetSettingsInput } from './setting-change.input';
import { SettingChanges } from './setting-change.policy';
import {
  AgentSettingView,
  ScheduleSettingsView,
  ScheduleSettingView,
  TeamSettingsView,
} from './setting-change.view';

// 설정 바꾸기 (2026-11-15 C · D)의 읽기: MCP get_settings와 제안의 지금 값.
// 읽는 에이전트: 대화 상대(관리자 바로 아래)나 승인 동작에 task.setting.change를 넣어 준 에이전트, 바깥길(브라우저 · 커넥터)이 없는 것만.
// 확인을 거치면 SettingActor로 그 설정을 가진 모듈에 묻는다 (platform SettingKinds). 에이전트 · 스케줄의 읽기는 여기 있다
@Injectable()
export class SettingQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly kinds: SettingKinds,
  ) {
    super(db);
  }

  /** get_settings: kind가 없으면 바꿀 수 있는 설정의 목록, 있으면 그 설정을 가진 모듈의 읽기 */
  async read(actor: Actor, req: GetSettingsInput): Promise<ToolAnswer> {
    const reader = await this.reader(actor);
    const kind = req.kind === null ? null : this.kinds.listed(req.kind);
    return kind ? kind.read(reader) : new SettingCatalogView(this.kinds.all());
  }

  /** 설정을 읽고 제안해도 되는 에이전트인가. 그렇다면 그 모듈에 넘길 제안자 */
  async reader(actor: Actor): Promise<SettingActor> {
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const me = await this.row(agents, { space_id: actor.spaceId, id: actor.agentId });
    if (!me) throw new Forbidden(Actor.AGENT);
    SettingChanges.assertInside(me.scopes, me.external_tools);
    if (me.reports_to !== null && !me.approval_actions.includes(Approval.SETTING_CHANGE))
      throw new Forbidden(
        Approval.SETTING_CHANGE,
        '설정은 대화 상대나 승인 동작에 설정 바꾸기를 넣어 준 에이전트만 봐요',
      );
    return new SettingActor(actor.spaceId, actor.agentId);
  }

  /** get_settings { kind: team }: 지운 에이전트는 빼고, 만든 순서 */
  async team(actor: Actor): Promise<TeamSettingsView> {
    const spaceId = SettingActor.spaceOf(actor);
    return new TeamSettingsView(
      await this.rows(agents, { space_id: spaceId, deleted_at: null }, { order: ['id'] }),
    );
  }

  /** get_settings { kind: schedules } */
  async schedules(actor: Actor): Promise<ScheduleSettingsView> {
    const spaceId = SettingActor.spaceOf(actor);
    return new ScheduleSettingsView(
      await this.rows(schedules, { space_id: spaceId }, { order: ['id'] }),
    );
  }

  /** 에이전트 제안의 지금 값 (바뀐 점의 바탕). 만들기면 null, 없거나 지운 것은 404 */
  async agentNow(actor: Actor, change: SettingChangeInput): Promise<AgentSettingView | null> {
    const spaceId = SettingActor.spaceOf(actor);
    if (change.targetId === null) return null;
    const row = await this.row(agents, {
      space_id: spaceId,
      id: change.targetId,
      deleted_at: null,
    });
    if (!row) throw new NotFound('에이전트를 찾을 수 없어요');
    return new AgentSettingView(row);
  }

  /** 스케줄 제안의 지금 값 (바뀐 점 · 고치기 본문의 바탕). 만들기면 null */
  async scheduleNow(actor: Actor, change: SettingChangeInput): Promise<ScheduleSettingView | null> {
    const spaceId = SettingActor.spaceOf(actor);
    if (change.targetId === null) return null;
    const row = await this.row(schedules, { space_id: spaceId, id: change.targetId });
    if (!row) throw new NotFound('스케줄을 찾을 수 없어요');
    return new ScheduleSettingView(row);
  }
}
