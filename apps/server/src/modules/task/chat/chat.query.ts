import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database, NotFound } from '../../platform';
import { Approval } from '../approval/approval';
import { Task } from '../task/task';
import type { ApprovalRow, ChatRow, TaskRow } from '../task.tables';
import type { ChatIdInput, ListChatsInput } from './chat.input';
import {
  type ChatApprovalRow,
  type ChatAutomationRow,
  type ChatCardOutputRow,
  type ChatCardTaskRow,
  ChatCardView,
  ChatDetailView,
  ChatListView,
  type ChatOutputRow,
  type ChatPartnerRow,
  type ChatTeamRow,
  type ChatTokenRow,
  type ChatTurnTaskRow,
  ChatTurnView,
  type ChatUpdateLine,
} from './chat.view';
import { ChatRequest } from './chat-request.policy';
import { ChatResult } from './chat-result.policy';
import { ChatReview } from './chat-review.policy';
import { ChatTrashLineView, ChatTrashView } from './chat-trash.view';
import { ChatUpdateQuery } from './chat-update.query';
import { TurnDeliver } from './turn-deliver.policy';

// 대화 읽기 (관리자만). 회차는 작업이라 그 대화의 회차 request_id로 작업을 찾는다.
// 결과물 · 기다리는 결재는 회차 작업과 그 아래 하위 작업(위임) 모두에서 모은다: 팀장에게 말하면 팀이 일한다.
// 상세에는 상태(ChatUpdateQuery와 같은 규칙) · 최근 소식(과정)을 함께 싣는다 (2차 1-1). 팀은 싣지 않는다: 화면은 대화만 (2차 1-5).
// 맡기 전의 대화는 회차가 없고 첫 메시지(pending)와 지금 질문을 싣는다
@Injectable()
export class ChatQuery extends BaseQuery {
  private static readonly PAGE = 100;
  private static readonly TRASH_LIMIT = 200;
  /** 상세에 싣는 최근 회차 수 */
  private static readonly TURNS = 100;
  /** 상세에 싣는 최근 소식 수 */
  private static readonly NEWS = 50;

  constructor(
    db: Database,
    private readonly updates: ChatUpdateQuery,
  ) {
    super(db);
  }

  /** 대화 목록 (최근 것부터): 맡은 에이전트의 이름과 상태 (상태판과 같은 규칙). 앱을 주면 그 앱의 대화만 (스토어 2단계) */
  async list(actor: Actor, req: ListChatsInput): Promise<ChatListView> {
    const rows = await this.updates.ownerBoard(actor, null, ChatQuery.PAGE, req.appId);
    if (rows.length === 0) return new ChatListView(rows);
    return new ChatListView(
      rows,
      await this.tokensByChat(
        actor.requireSpace(),
        rows.map((r) => r.id),
      ),
    );
  }

  /** 휴지통의 대화 (관리자만). 넣은 때가 늦은 순으로 TRASH_LIMIT개까지 (2026-11-19 휴지통 A) */
  async trash(actor: Actor): Promise<ChatTrashView> {
    actor.assertOwner();
    const rows = await this.sql<
      (Pick<ChatRow, 'id' | 'title' | 'turns' | 'app_id' | 'updated_at' | 'version'> & {
        deleted_at: Date;
      })[]
    >`
      SELECT id, title, turns, app_id, updated_at, version, deleted_at FROM task.chats
      WHERE space_id = ${actor.requireSpace()} AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC, id DESC LIMIT ${ChatQuery.TRASH_LIMIT}`;
    return new ChatTrashView(rows.map((r) => new ChatTrashLineView(r)));
  }

  async get(actor: Actor, req: ChatIdInput): Promise<ChatDetailView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const [chat] = await this.sql<ChatRow[]>`
      SELECT * FROM task.chats WHERE space_id = ${spaceId} AND id = ${req.id} AND deleted_at IS NULL`;
    if (!chat) throw new NotFound('대화를 찾을 수 없어요');
    const [partner] = await this.sql<ChatPartnerRow[]>`
      SELECT name, status, reports_to, deleted_at FROM task.agents WHERE id = ${chat.agent_id}`;
    const ids = ChatRequest.turns(chat.id, chat.turns - ChatQuery.TURNS + 1, chat.turns);
    const turns = await this.turns(spaceId, ids);
    const [board] = await this.updates.ownerBoard(actor, chat.id);
    // 맡을 에이전트를 묻는 질문은 O-2에서 없앴다 (상대는 늘 대표). 칸은 O-3에서 지운다
    return new ChatDetailView(
      chat,
      partner ?? null,
      await this.views(turns),
      board ?? null,
      await this.news(chat.id),
      await this.automations(spaceId, chat.id),
      await this.card(chat),
      await this.team(spaceId, chat.id),
      await this.tokens(spaceId, chat.id),
    );
  }

  /**
   * 이 대화의 일이 쓴 토큰 (O-1): 회차 · 덧붙인 말의 답 · 검토(request_id `chat:<대화>:<회차>…`) · O-2 전의 배정(`chat-route:<대화>:`)과
   * 그 아래 하위 작업 전부의 실행 기록. 회차는 맨 위 작업의 request_id 세 번째 칸 (배정은 null)
   */
  private tokens(spaceId: string, chatId: string): Promise<ChatTokenRow[]> {
    return this.sql<ChatTokenRow[]>`
      WITH RECURSIVE tree AS (
        SELECT id, request_id AS root FROM task.tasks
        WHERE space_id = ${spaceId}
          AND (request_id LIKE ${`${ChatRequest.TURN_PREFIX}${chatId}:%`}
            OR request_id LIKE ${`${ChatRequest.route(chatId)}%`})
        UNION ALL
        SELECT c.id, tree.root FROM task.tasks c JOIN tree ON c.parent_id = tree.id
      )
      SELECT
        CASE WHEN tree.root LIKE ${`${ChatRequest.TURN_PREFIX}%`} AND split_part(tree.root, ':', 3) ~ '^[0-9]+$'
          THEN split_part(tree.root, ':', 3)::int END AS turn,
        t.agent_id, a.name AS agent, sum(e.tokens)::bigint AS tokens
      FROM tree
      JOIN task.tasks t ON t.id = tree.id
      JOIN task.task_events e ON e.task_id = tree.id
      LEFT JOIN task.agents a ON a.id = t.agent_id
      GROUP BY 1, t.agent_id, a.name
      HAVING sum(e.tokens) > 0`;
  }

  /** 대화마다 쓴 토큰의 합 (목록, O-1). 대화 상세의 usage.tokens와 같은 수 */
  private async tokensByChat(
    spaceId: string,
    chatIds: readonly string[],
  ): Promise<Map<string, number>> {
    const rows = await this.sql<{ chat_id: string; tokens: string }[]>`
      WITH RECURSIVE tree AS (
        SELECT id, split_part(request_id, ':', 2) AS chat_id FROM task.tasks
        WHERE space_id = ${spaceId}
          AND (request_id LIKE ${`${ChatRequest.TURN_PREFIX}%`} OR request_id LIKE ${`${ChatRequest.ROUTE_PREFIX}%`})
          AND split_part(request_id, ':', 2) = ANY(${chatIds as string[]}::text[])
        UNION ALL
        SELECT c.id, tree.chat_id FROM task.tasks c JOIN tree ON c.parent_id = tree.id
      )
      SELECT tree.chat_id, sum(e.tokens)::bigint AS tokens
      FROM tree JOIN task.task_events e ON e.task_id = tree.id
      GROUP BY tree.chat_id`;
    return new Map(rows.map((r) => [r.chat_id, Number(r.tokens)]));
  }

  /**
   * 이 대화의 일(회차 · 덧붙인 말의 답 · 검토, request_id `chat:<대화>:`)과 그 아래에서 끝나지 않은 작업 (2026-11-15).
   * 끝나지 않은 하위 작업의 위 작업은 늘 하위 작업을 기다리는 중이라, 끝나지 않은 것만 따라 내려가면 된다
   */
  private team(spaceId: string, chatId: string): Promise<ChatTeamRow[]> {
    const open = ChatQuery.OPEN as string[];
    return this.sql<ChatTeamRow[]>`
      WITH RECURSIVE tree AS (
        SELECT id FROM task.tasks
        WHERE space_id = ${spaceId} AND request_id LIKE ${`${ChatRequest.TURN_PREFIX}${chatId}:%`}
          AND status = ANY(${open}::text[])
        UNION ALL
        SELECT c.id FROM task.tasks c JOIN tree ON c.parent_id = tree.id
        WHERE c.status = ANY(${open}::text[])
      )
      SELECT t.id, t.agent_id, t.title, t.status, t.wait_reason, t.wait_until, t.created_at, t.parent_id,
        a.name AS agent,
        (SELECT e.body FROM task.task_events e
          WHERE e.task_id = t.id AND e.body <> '' ORDER BY e.id DESC LIMIT 1) AS last_event
      FROM tree JOIN task.tasks t ON t.id = tree.id
      LEFT JOIN task.agents a ON a.id = t.agent_id
      ORDER BY t.created_at, t.id`;
  }

  /** 기다리는 결과 카드: 실린 결재 · 결과물, 받을 것의 검사, 그 회차의 검토 (2차 2단계) */
  private async card(chat: ChatRow): Promise<ChatCardView | null> {
    const [card] = await this.sql<ApprovalRow[]>`
      SELECT * FROM task.approvals
      WHERE action = ${Approval.CARD} AND target_id = ${chat.id} AND status = ${Approval.PENDING}`;
    if (!card) return null;
    const actions = await this.sql<ApprovalRow[]>`
      SELECT * FROM task.approvals
      WHERE card_id = ${card.id} AND status = ${Approval.PENDING} ORDER BY id`;
    const outputs = await this.sql<ChatCardOutputRow[]>`
      SELECT id, name, kind, mime, task_id FROM task.outputs
      WHERE card_id = ${card.id} AND deleted_at IS NULL ORDER BY id`;
    const makers = [
      ...new Set([...actions.map((a) => a.task_id), ...outputs.map((o) => o.task_id)]),
    ].filter((id): id is string => id !== null);
    const tasks = await this.sql<ChatCardTaskRow[]>`
      SELECT id, result FROM task.tasks WHERE id = ANY(${makers}::uuid[])`;
    const [review] = await this.sql<Pick<TaskRow, 'status' | 'result'>[]>`
      SELECT status, result FROM task.tasks
      WHERE space_id = ${chat.space_id}
        AND request_id = ${ChatRequest.review(chat.id, card.target_version)}`;
    // 카드의 회차까지 이어진 다시 맡긴 회차 (받을 것 · 검토 반영, 검증 고리 V)
    const turns = await this.sql<Pick<TaskRow, 'payload'>[]>`
      SELECT payload FROM task.tasks
      WHERE space_id = ${chat.space_id}
        AND request_id = ANY(${ChatRequest.turns(chat.id, card.target_version - ChatResult.FIX_MAX - ChatReview.FIX_MAX, card.target_version)}::text[])
      ORDER BY created_at, id`;
    const fixes = ChatResult.fixesIn(turns);
    const byReview = ChatResult.fixesIn(turns, ChatResult.BY_REVIEW);
    // 받을 것: 카드의 회차에 대표가 정한 값, 없으면 대화의 값 (O-3)
    const deliver = TurnDeliver.effective(turns.at(-1)?.payload, chat.deliver);
    const missing = ChatResult.missing(
      deliver,
      actions.map((a) => a.action),
      outputs.map((o) => o.name),
    );
    const said = review?.status === Task.DONE ? ChatResult.textOf(review.result) : '';
    return new ChatCardView(
      card,
      actions,
      outputs,
      tasks,
      deliver,
      // 받을 것이 아직 없어도 승인 뒤 이어서 낼 것이면 그렇게 보인다 (스토어 2-6)
      {
        passed: missing === null,
        continues: missing !== null && ChatResult.continuesAfter(actions),
      },
      said ? ChatReview.parse(said) : null,
      { deliver: fixes - byReview, review: byReview },
    );
  }

  /** 이 대화에 회차를 쌓는 자동화 (O-3, 대화 레시피의 chat_id) */
  private automations(spaceId: string, chatId: string): Promise<ChatAutomationRow[]> {
    return this.sql<ChatAutomationRow[]>`
      SELECT id, title, enabled, trigger, mode, weekdays, every_hours, every_minutes, next_run_at,
        CASE WHEN at_minute IS NULL THEN NULL
          ELSE lpad((at_minute / 60)::text, 2, '0') || ':' || lpad((at_minute % 60)::text, 2, '0') END AS at_time
      FROM task.schedules
      WHERE space_id = ${spaceId} AND chat_id = ${chatId} AND destination = 'chat'
      ORDER BY created_at, id`;
  }

  /** 이 대화의 최근 소식 (오래된 것부터) */
  private news(chatId: string): Promise<ChatUpdateLine[]> {
    return this.sql<ChatUpdateLine[]>`
      SELECT * FROM (
        SELECT u.*, a.name AS agent
        FROM task.chat_updates u
        LEFT JOIN task.agents a ON a.id = u.agent_id
        WHERE u.chat_id = ${chatId} ORDER BY u.n DESC LIMIT ${ChatQuery.NEWS}
      ) recent ORDER BY n`;
  }

  /** 회차마다 그 아래의 결과물 · 기다리는 결재를 붙인다 */
  private async views(turns: readonly ChatTurnTaskRow[]): Promise<ChatTurnView[]> {
    const roots = turns.map((t) => t.id);
    const [outputs, approvals] = await Promise.all([this.outputs(roots), this.approvals(roots)]);
    return turns.map((t) => new ChatTurnView(t, outputs, approvals));
  }

  private turns(spaceId: string, ids: readonly string[]): Promise<ChatTurnTaskRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.sql<ChatTurnTaskRow[]>`
      SELECT t.*,
        (SELECT e.body FROM task.task_events e
          WHERE e.task_id = t.id AND e.body <> '' ORDER BY e.id DESC LIMIT 1) AS last_event,
        (SELECT count(*)::int FROM task.tasks c
          WHERE c.parent_id = t.id AND c.status = ANY(${ChatQuery.OPEN}::text[])) AS open_subtasks
      FROM task.tasks t
      WHERE t.space_id = ${spaceId} AND t.request_id = ANY(${ids as string[]}::text[])
      ORDER BY t.created_at, t.id`;
  }

  /** 회차마다 그 아래(하위 작업 포함)에서 만든 결과물 (휴지통 제외) */
  private outputs(roots: readonly string[]): Promise<ChatOutputRow[]> {
    if (roots.length === 0) return Promise.resolve([]);
    return this.sql<ChatOutputRow[]>`
      WITH RECURSIVE tree AS (
        SELECT id, id AS root FROM task.tasks WHERE id = ANY(${roots as string[]}::uuid[])
        UNION ALL
        SELECT c.id, tree.root FROM task.tasks c JOIN tree ON c.parent_id = tree.id)
      SELECT tree.root, o.id, o.name, o.kind FROM tree
      JOIN task.outputs o ON o.task_id = tree.id AND o.deleted_at IS NULL
      ORDER BY o.id`;
  }

  /** 회차마다 그 아래(하위 작업 포함)에서 기다리는, 결과 카드에 싣지 않는 결재(바로 알리는 동작): 대화 안에서 바로 결정한다 */
  private approvals(roots: readonly string[]): Promise<ChatApprovalRow[]> {
    if (roots.length === 0) return Promise.resolve([]);
    return this.sql<ChatApprovalRow[]>`
      WITH RECURSIVE tree AS (
        SELECT id, id AS root FROM task.tasks WHERE id = ANY(${roots as string[]}::uuid[])
        UNION ALL
        SELECT c.id, tree.root FROM task.tasks c JOIN tree ON c.parent_id = tree.id)
      SELECT tree.root, a.id FROM tree
      JOIN task.approvals a ON a.task_id = tree.id AND a.status = ${Approval.PENDING}
        AND a.chat_id IS NULL
      ORDER BY a.id`;
  }

  private static readonly OPEN: readonly string[] = [Task.QUEUED, Task.RUNNING, Task.WAITING];
}
