import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, NotFound } from '../../platform';
import type { RunMemoRow, SessionRow } from '../vault.tables';
import { Session } from './session';
import type { ReadSessionInput } from './session.input';
import { WorkSessionView } from './work-session.view';

// 작업 세션 화면 (S2, 2026-11-28): 에이전트 실행의 기록(도구 cairn-agent)에만 있는 것. 요청의 열쇠(대화 · 목표 실행 · 작업),
// 정리할 판(끝난 요청까지) · 정리를 요청한 판, 인수인계 메모(최근 MEMOS개, 새것부터). 관리자만
@Injectable()
export class WorkSessionQuery extends BaseQuery {
  private static readonly MEMOS = 50;

  async get(actor: Actor, req: ReadSessionInput): Promise<WorkSessionView> {
    actor.assertOwner();
    const [row] = await this.sql<SessionRow[]>`
      SELECT s.* FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.node_id = ${req.id} AND s.space_id = ${actor.requireSpace()}
        AND s.tool = ${Session.AGENT_TOOL} AND n.deleted_at IS NULL`;
    if (!row) throw new NotFound('작업 세션을 찾을 수 없어요');
    const memos = await this.sql<RunMemoRow[]>`
      SELECT * FROM vault.run_memos WHERE session_id = ${req.id}
      ORDER BY created_at DESC, id DESC LIMIT ${WorkSessionQuery.MEMOS}`;
    return new WorkSessionView(row, memos);
  }
}
