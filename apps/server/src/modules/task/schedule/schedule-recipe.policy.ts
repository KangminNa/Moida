import { RuleViolation, type Unchecked, ValueList } from '../../platform';
import { ChatResult } from '../chat/chat-result.policy';
import { SCHEDULE_DESTINATION, SCHEDULE_TRIGGER, type ScheduleRow } from '../task.tables';

// 자동화 레시피의 칸이 서로 맞는가 (2차 5단계, Schedule.configure가 부른다):
// 어디로 ↔ 페이지 · 담당 · 지시, 받을 것 · 메일로 받기(2026-11-27)는 대화에만, 계기 ↔ 앞 레시피.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳 (Schedule이 300줄을 넘지 않게 뗐다)
export class ScheduleRecipe {
  static readonly RULES_MAX = 2000;

  /** 맞으면 값 목록으로 좁힌 어디로 · 받을 것 · 계기를 돌려준다 */
  static check(
    r: Pick<
      Unchecked<ScheduleRow>,
      | 'id'
      | 'destination'
      | 'page_id'
      | 'agent_id'
      | 'instruction'
      | 'deliver'
      | 'mail'
      | 'rules'
      | 'trigger'
      | 'after_id'
    >,
  ): Pick<ScheduleRow, 'destination' | 'deliver' | 'trigger'> {
    const { destination, deliver, trigger } = r;
    if (!ValueList.has(SCHEDULE_DESTINATION, destination))
      throw new RuleViolation(`어디로는 ${SCHEDULE_DESTINATION.join(' · ')} 중 하나예요`);
    if ((destination === 'page') !== (r.page_id !== null))
      throw new RuleViolation('페이지로 보내면 페이지를 골라요 (다른 곳이면 비워요)');
    const chat = destination === 'chat';
    // 대화로 보내는 레시피는 대표가 맡는다 (O-2): 담당은 비운다
    if (chat && r.agent_id !== null)
      throw new RuleViolation('대화로 보내는 스케줄은 대표가 맡아요 (담당을 비워요)');
    if (chat && r.instruction.trim() === '')
      throw new RuleViolation('대화로 보내면 지시가 있어야 해요');
    if (deliver !== null && !chat) throw new RuleViolation('받을 것은 대화로 보낼 때만 정해요');
    if (r.mail && !chat) throw new RuleViolation('메일로 받기는 대화로 보낼 때만 정해요');
    const checked = ChatResult.deliverOf(deliver);
    if (r.rules.length > ScheduleRecipe.RULES_MAX)
      throw new RuleViolation(`지킬 것은 ${ScheduleRecipe.RULES_MAX}자까지예요`);
    if (!ValueList.has(SCHEDULE_TRIGGER, trigger))
      throw new RuleViolation(`계기는 ${SCHEDULE_TRIGGER.join(' · ')} 중 하나예요`);
    if ((trigger === 'after') !== (r.after_id !== null))
      throw new RuleViolation('다른 레시피 뒤에 돌리려면 그 레시피를 골라요');
    if (r.after_id !== null && r.after_id === r.id)
      throw new RuleViolation('자기 뒤에 돌 수는 없어요');
    return { destination, deliver: checked, trigger };
  }
}
