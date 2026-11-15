import { Injectable } from '@nestjs/common';
import { Actor, AgentActor, BaseQuery, Forbidden, NotFound } from '../../platform';
import { Approval } from '../approval/approval';
import { agents, schedules } from '../task.schema';
import { GetSettingsInput } from './setting-change.input';
import { SettingChanges } from './setting-change.policy';
import {
  AgentSettingView,
  ScheduleSettingsView,
  ScheduleSettingView,
  TeamSettingsView,
} from './setting-change.view';

// 설정 바꾸기 (2026-11-15 C)의 읽기: MCP get_settings와 제안의 지금 값.
// 읽는 에이전트: 대화 상대(관리자 바로 아래)나 승인 동작에 task.setting.change를 넣어 준 에이전트, 바깥길(브라우저 · 커넥터)이 없는 것만
@Injectable()
export class SettingQuery extends BaseQuery {
  /** 팀(지운 에이전트는 빼고, 만든 순서) 또는 스케줄 전부 */
  async read(
    actor: Actor,
    req: GetSettingsInput,
  ): Promise<TeamSettingsView | ScheduleSettingsView> {
    const spaceId = await this.assertReader(actor);
    if (req.kind === GetSettingsInput.TEAM)
      return new TeamSettingsView(
        await this.rows(agents, { space_id: spaceId, deleted_at: null }, { order: ['id'] }),
      );
    return new ScheduleSettingsView(
      await this.rows(schedules, { space_id: spaceId }, { order: ['id'] }),
    );
  }

  /** 제안의 지금 값 (바뀐 점 · 스케줄 고치기의 바탕). 만들기면 null, 없거나 지운 것은 404 */
  async before(
    actor: Actor,
    setting: string,
    id: string | null,
  ): Promise<AgentSettingView | ScheduleSettingView | null> {
    const spaceId = await this.assertReader(actor);
    if (id === null) return null;
    if (setting === SettingChanges.AGENT) {
      const row = await this.row(agents, { space_id: spaceId, id, deleted_at: null });
      if (!row) throw new NotFound('에이전트를 찾을 수 없어요');
      return new AgentSettingView(row);
    }
    const row = await this.row(schedules, { space_id: spaceId, id });
    if (!row) throw new NotFound('스케줄을 찾을 수 없어요');
    return new ScheduleSettingView(row);
  }

  private async assertReader(actor: Actor): Promise<string> {
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const me = await this.row(agents, { space_id: actor.spaceId, id: actor.agentId });
    if (!me) throw new Forbidden(Actor.AGENT);
    SettingChanges.assertInside(me.scopes, me.external_tools);
    if (me.reports_to !== null && !me.approval_actions.includes(Approval.SETTING_CHANGE))
      throw new Forbidden(
        Approval.SETTING_CHANGE,
        '설정은 대화 상대나 승인 동작에 설정 바꾸기를 넣어 준 에이전트만 봐요',
      );
    return actor.spaceId;
  }
}
