import { BaseEntity, RuleViolation, TableEntity } from '../../platform';
import type { ApiCallHeldReason, ApiCallNew, ApiCallRow } from '../task.tables';
import { ApiCallLineView, ApiCallView } from './api-connector.view';
import type { ApiOperation } from './api-operation.policy';

/** 부른 쪽: 일의 작업 · 실행 · 에이전트 (관리자의 시험은 모두 없다) */
export type ApiCaller = { taskId: string | null; runId: string | null; agentId: string | null };

// API 부르기 한 번 (task.api_calls, 2026-11-24): 첫 요청 → (상태 다시 묻기) → (파일 받기) → 끝.
//   held: 쓰기 동작이거나 하루 한도를 넘어 승인을 기다림 (결재 task.api.call) → 승인되면 running
//   running: 첫 요청을 보내는 중 / polling: 일꾼(ApiCallJob)이 next_at마다 상태를 묻는 중 / fetching: 끝난 답의 파일을 받는 중
//   done · failed · refused(승인되지 않음)
// 상태를 다시 묻는 주소 · 파일 주소는 서버가 정의서대로 만든 것만 쓴다. 파일 주소는 받은 뒤 지운다 (서명된 주소를 오래 들고 있지 않게)
export class ApiCall extends TableEntity<ApiCallRow, ApiCallNew> {
  /** 승인 뒤 한 번 부르는 결재 */
  static readonly ACTION = 'task.api.call';
  static readonly TARGET = 'api_call';
  /** 상태 묻기 · 파일 받기를 하는 마감 작업 (ApiCallJob). next_at이 바뀌면 저장이 깨운다 */
  static readonly JOB = 'task.api_calls';
  /** AI에게 돌려주는 답의 크기 */
  static readonly ANSWER_MAX = 20_000;
  private static readonly ERROR_MAX = 500;

  static open(
    connector: { id: string; spaceId: string },
    op: ApiOperation,
    caller: ApiCaller,
    requestId: string,
    input: Readonly<Record<string, unknown>>,
    held: ApiCallHeldReason | null,
    now: Date,
  ): ApiCall {
    return new ApiCall(
      {
        id: BaseEntity.newId(),
        space_id: connector.spaceId,
        connector_id: connector.id,
        operation: op.name,
        effect: op.effect,
        task_id: caller.taskId,
        run_id: caller.runId,
        agent_id: caller.agentId,
        request_id: requestId,
        input,
        status: held ? 'held' : 'running',
        held_reason: held,
        created_at: now,
        updated_at: now,
      },
      true,
    );
  }

  static restore(row: ApiCallRow): ApiCall {
    return new ApiCall(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get connectorId(): string {
    return this.row.connector_id;
  }

  get operation(): string {
    return this.row.operation;
  }

  get status(): ApiCallRow['status'] {
    return this.row.status;
  }

  get input(): Record<string, unknown> {
    return (this.row.input ?? {}) as Record<string, unknown>;
  }

  get vars(): Record<string, unknown> {
    return (this.row.vars ?? {}) as Record<string, unknown>;
  }

  get fileUrls(): readonly string[] {
    return this.row.file_urls;
  }

  get taskId(): string | null {
    return this.row.task_id;
  }

  get runId(): string | null {
    return this.row.run_id;
  }

  get approvalId(): string | null {
    return this.row.approval_id;
  }

  get heldReason(): ApiCallHeldReason | null {
    return this.row.held_reason;
  }

  /** 일꾼이 이 부르기를 맡는다: 다음 차례를 ms 뒤로 미뤄 다른 일꾼 · 다음 차례가 겹쳐 하지 않게 (끝나면 다시 정한다) */
  claim(now: Date, ms: number): void {
    this.assertIn(['polling', 'fetching']);
    this.put('next_at', new Date(now.getTime() + ms));
  }

  /** 승인을 기다리는 결재를 적는다 */
  waitFor(approvalId: string): void {
    if (this.row.status !== 'held') throw new RuleViolation('승인을 기다리는 부르기가 아니에요');
    this.put('approval_id', approvalId);
  }

  /** 그 결재가 승인됐다: 보낼 차례. 이미 지났으면 false (두 번 와도 같다) */
  approve(approvalId: string, now: Date): boolean {
    if (this.row.status !== 'held' || this.row.approval_id !== approvalId) return false;
    this.put('status', 'running');
    this.put('updated_at', now);
    return true;
  }

  /** 승인되지 않았다 */
  refuse(approvalId: string, now: Date): void {
    if (this.row.status !== 'held' || this.row.approval_id !== approvalId) return;
    this.put('status', 'refused');
    this.put('error', '승인되지 않았어요');
    this.close(now);
  }

  /** 첫 답: 상태를 다시 물을 동작이면 polling, 아니면 끝난 답 */
  answered(answer: unknown, op: ApiOperation, now: Date): void {
    this.assertIn(['running']);
    if (op.poll) {
      const picked = op.picked(answer, false);
      const vars = { ...this.input, ...(picked && typeof picked === 'object' ? picked : {}) };
      this.put('vars', vars);
      this.put('answer', ApiCall.trim(picked));
      this.put('status', 'polling');
      this.put('next_at', new Date(now.getTime() + op.poll.everySeconds * 1000));
      this.put('give_up_at', new Date(now.getTime() + op.poll.maxMinutes * 60_000));
      this.put('updated_at', now);
      return;
    }
    this.settle(answer, op, false, now);
  }

  /** 상태를 다시 물은 답 */
  polled(answer: unknown, op: ApiOperation, now: Date): void {
    this.assertIn(['polling']);
    const poll = op.poll;
    if (!poll) {
      this.fail('정의서에 상태 묻기가 없어요', now);
      return;
    }
    this.put('polls', this.row.polls + 1);
    const state = poll.stateOf(answer);
    if (state === 'done') {
      this.settle(answer, op, true, now);
      return;
    }
    if (state === 'failed') {
      this.put('answer', ApiCall.trim(op.picked(answer, true)));
      this.fail('서비스가 실패로 알렸어요', now);
      return;
    }
    const next = new Date(now.getTime() + poll.everySeconds * 1000);
    if (this.row.give_up_at && next > this.row.give_up_at) {
      this.fail(`${poll.maxMinutes}분을 기다려도 끝나지 않았어요`, now);
      return;
    }
    this.put('next_at', next);
    this.put('updated_at', now);
  }

  /** 상태 묻기가 잠깐 실패했다: 다음 차례에 다시 (기한 안에서) */
  pollMissed(error: string, everySeconds: number, now: Date): void {
    this.assertIn(['polling']);
    const next = new Date(now.getTime() + everySeconds * 1000);
    if (this.row.give_up_at && next > this.row.give_up_at) {
      this.fail(error, now);
      return;
    }
    this.put('polls', this.row.polls + 1);
    this.put('next_at', next);
    this.put('updated_at', now);
  }

  /** 파일을 받았다 (받지 못한 것은 까닭을 남긴다) */
  filesKept(outputIds: readonly string[], errors: readonly string[], now: Date): void {
    this.assertIn(['fetching']);
    this.put('output_ids', outputIds);
    this.put('file_urls', []);
    if (errors.length > 0)
      this.put(
        'error',
        `파일 ${errors.length}개를 받지 못했어요: ${errors[0]}`.slice(0, ApiCall.ERROR_MAX),
      );
    this.put('status', outputIds.length > 0 || errors.length === 0 ? 'done' : 'failed');
    this.close(now);
  }

  fail(error: string, now: Date): void {
    this.put('status', 'failed');
    this.put('error', error.slice(0, ApiCall.ERROR_MAX));
    this.put('file_urls', []);
    this.close(now);
  }

  view(): ApiCallView {
    return new ApiCallView(this.row);
  }

  /** 관리 화면의 한 줄 (시험의 답) */
  lineView(): ApiCallLineView {
    return new ApiCallLineView(this.row);
  }

  /** 끝난 답: 꺼낸 값을 남기고, 파일 칸이 있으면 받으러 간다 */
  private settle(answer: unknown, op: ApiOperation, polled: boolean, now: Date): void {
    this.put('answer', ApiCall.trim(op.picked(answer, polled)));
    const urls = op.fileUrls(answer);
    if (urls.length === 0) {
      this.put('status', 'done');
      this.close(now);
      return;
    }
    this.put('file_urls', urls);
    this.put('status', 'fetching');
    this.put('next_at', now);
    this.put('updated_at', now);
  }

  private close(now: Date): void {
    this.put('next_at', null);
    this.put('finished_at', now);
    this.put('updated_at', now);
  }

  private assertIn(states: readonly ApiCallRow['status'][]): void {
    if (!states.includes(this.row.status))
      throw new RuleViolation(`지금(${this.row.status})은 할 수 없어요`);
  }

  /** AI에게 돌려줄 크기로 (넘으면 앞부분 글자만) */
  private static trim(value: unknown): unknown {
    const text = JSON.stringify(value ?? null);
    if (text.length <= ApiCall.ANSWER_MAX) return value ?? null;
    return { trimmed: true, text: text.slice(0, ApiCall.ANSWER_MAX) };
  }
}
