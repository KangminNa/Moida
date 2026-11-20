import { TableRepository } from '../../platform';
import { ChatRequest } from '../chat/chat-request.policy';
import { verdicts } from '../task.schema';
import type { TaskRow, VerdictRow } from '../task.tables';
import { Verdict } from './verdict';

/** 검토한 회차 작업과 그 회차에서 일한 바로 아래 에이전트들 (판정받은 쪽) */
export type VerdictTurnRow = Pick<TaskRow, 'id' | 'agent_id' | 'payload'> & {
  members: readonly string[];
};

// task.verdicts ↔ Verdict (추가만). 저장은 기반이 하고, 여기에는 판정을 남길 때 필요한 읽기만 있다
export class VerdictRepository extends TableRepository<VerdictRow, Verdict> {
  protected readonly table = verdicts;
  protected readonly noun = '판정';

  protected toEntity(row: VerdictRow): Verdict {
    return Verdict.restore(row);
  }

  /** 이 판정 작업의 판정을 이미 남겼는가 (두 번 불려도 같게) */
  async judged(spaceId: string, judgeTaskId: string): Promise<boolean> {
    return (await this.findOne({ space_id: spaceId, task_id: judgeTaskId })) !== null;
  }

  /**
   * 같은 대상에 같은 판정자가 앞서 준 점수(평균) 가운데 가장 최근 것. 이번 판정 작업은 뺀다.
   * 검수가 "고쳐 왔는데 점수가 오르지 않았는가"를 본다 (ChatInspect.stalled). 없거나 점수가 없으면 null
   */
  async lastScore(
    spaceId: string,
    target: string,
    judgeAgentId: string,
    exceptTaskId: string,
  ): Promise<number | null> {
    const [row] = await this.sql<{ score: number | null }[]>`
      SELECT v.score FROM task.verdicts v JOIN task.tasks j ON j.id = v.task_id
      WHERE v.space_id = ${spaceId} AND v.target = ${target} AND v.task_id <> ${exceptTaskId}
        AND j.agent_id = ${judgeAgentId}
      ORDER BY v.created_at DESC, v.id DESC LIMIT 1`;
    return row?.score ?? null;
  }

  /** 검토한 회차 작업과 그 바로 아래 하위 작업의 에이전트들 (대표가 맡긴 팀장들). 회차가 없으면 null */
  async turnOf(spaceId: string, chatId: string, turn: number): Promise<VerdictTurnRow | null> {
    const [row] = await this.sql<VerdictTurnRow[]>`
      SELECT t.id, t.agent_id, t.payload,
        ARRAY(
          SELECT DISTINCT s.agent_id::text FROM task.tasks s
          WHERE s.parent_id = t.id AND s.agent_id IS NOT NULL
        ) AS members
      FROM task.tasks t
      WHERE t.space_id = ${spaceId} AND t.request_id = ${ChatRequest.turn(chatId, turn)}`;
    return row ?? null;
  }
}
