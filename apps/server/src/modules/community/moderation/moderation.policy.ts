import { Conflict, RuleViolation, ValueList } from '../../platform';
import type { DecisionAction, ReportState, TopicHiddenBy, TopicState } from '../community.tables';

// 글 · 댓글의 가림 규칙 (스토어 3-1c, 11.5). 글과 댓글은 같은 상태(shown · hidden · removed · deleted)를 갖고 같은 규칙을 따른다.
//   신고로 가림: 서로 다른 회원의 열린 신고가 HIDE_AT건이면 시스템이 임시로 가린다 (보이는 것만, 정보통신망법의 임시조치)
//   관리자 결정: 가림(hide) · 되돌림(show) · 내림(remove). 쓴 회원이 지운 것(deleted)은 정하지 않는다.
//     되돌림은 가린 것 · 내린 것을 다시 보이고 열린 신고를 기각한다. 가림 · 내림은 열린 신고를 인정한다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class Moderation {
  /** 이만큼의 서로 다른 회원이 신고하면 임시로 가린다 */
  static readonly HIDE_AT = 3;
  static readonly NOTE_MAX = 500;
  /** 글 · 댓글에 내리는 결정 (회원의 결정은 block · unblock · reset_password) */
  static readonly CONTENT_ACTIONS: readonly DecisionAction[] = ['hide', 'show', 'remove'];

  /** 글 · 댓글의 결정인가 (아니면 422) */
  static contentAction(action: string): DecisionAction {
    if (!ValueList.has(Moderation.CONTENT_ACTIONS, action))
      throw new RuleViolation('가림(hide) · 되돌림(show) · 내림(remove) 가운데 골라 주세요');
    return action;
  }

  /** 관리자 결정 뒤의 상태와 가린 까닭 */
  static next(
    state: TopicState,
    action: DecisionAction,
  ): readonly [TopicState, TopicHiddenBy | null] {
    if (state === 'deleted') throw new Conflict('쓴 회원이 지운 것이에요');
    if (action === 'show') return ['shown', null];
    if (state === 'removed')
      throw new Conflict(
        action === 'remove' ? '이미 내렸어요' : '내린 것은 되돌린 뒤에 가려 주세요',
      );
    if (action === 'hide') return ['hidden', 'owner'];
    if (action === 'remove') return ['removed', null];
    throw new RuleViolation('글 · 댓글에 내릴 수 없는 결정이에요');
  }

  /** 신고가 쌓였는가: 서로 다른 회원의 열린 신고 수 */
  static reachesHide(reporters: number): boolean {
    return reporters >= Moderation.HIDE_AT;
  }

  /** 결정에 따라 열린 신고를 닫는 값: 되돌림은 기각, 가림 · 내림은 인정 */
  static reportOutcome(action: DecisionAction): ReportState {
    return action === 'show' ? 'dismissed' : 'accepted';
  }

  /** 결정 메모: 앞뒤 공백을 빼고, 비면 없음 */
  static note(note: string | null): string | null {
    const clean = note?.trim() ?? '';
    if ([...clean].length > Moderation.NOTE_MAX)
      throw new RuleViolation(`메모는 ${Moderation.NOTE_MAX}자까지예요`);
    return clean === '' ? null : clean;
  }
}
