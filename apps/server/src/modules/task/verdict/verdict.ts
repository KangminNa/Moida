import { BaseEntity, TableEntity } from '../../platform';
import type { ChatReviewVerdict } from '../chat/chat.view';
import { ChatReview } from '../chat/chat-review.policy';
import type { VerdictNew, VerdictRow } from '../task.tables';

// 판정 한 줄 (task.verdicts, 추가만, 2026-11-20 평가가 남는 팀). 검토 · 검수 작업 하나가 끝나면 판정받은 에이전트마다 남긴다:
// 검수는 결재를 올린 에이전트, 검토는 그 회차에 일한 바로 아래 팀장들(없으면 대표). 점수는 ChatReview.parse의 평균 · 가장 낮은 점수.
// 같은 대상의 판정은 target으로 잇는다: 검수는 대화 · 동작 · 대상(ApprovalRepository.inspectorFixes와 같은 열쇠),
// 검토는 대화와 처음 회차(검토 반영으로 다시 맡긴 회차는 앞 회차를 가리킨다). 성적표(TeamRoster)와 주간 팀 점검이 읽는다
export class Verdict extends TableEntity<VerdictRow, VerdictNew> {
  static readonly REVIEW = 'review';
  static readonly INSPECT = 'inspect';

  /** 검수 판정의 대상 열쇠 */
  static inspectTarget(chatId: string, action: string, targetId: string): string {
    return `inspect:${chatId}:${action}:${targetId}`;
  }

  /** 검토 판정의 대상 열쇠: 검토 반영으로 다시 맡긴 회차(fixed)는 앞 회차와 같은 대상이다 */
  static reviewTarget(chatId: string, turn: number, fixed: boolean): string {
    return `review:${chatId}:${fixed ? Math.max(1, turn - 1) : turn}`;
  }

  /** 판정 하나 (판정 작업 · 판정받은 에이전트마다 한 줄) */
  static of(
    spaceId: string,
    judgeTaskId: string,
    agentId: string,
    kind: VerdictRow['kind'],
    target: string,
    round: number,
    review: ChatReviewVerdict,
    now: Date,
  ): Verdict {
    return new Verdict(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        task_id: judgeTaskId,
        agent_id: agentId,
        kind,
        target: target.slice(0, 200),
        round: Math.max(1, round),
        verdict: review.verdict,
        score: review.score,
        low: ChatReview.lowOf(review),
        created_at: now,
      },
      true,
    );
  }

  static restore(row: VerdictRow): Verdict {
    return new Verdict(row);
  }
}
