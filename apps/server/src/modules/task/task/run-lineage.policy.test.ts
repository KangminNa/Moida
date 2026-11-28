import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import type { TaskRow, TaskRunNew, TaskRunRow } from '../task.tables';
import { RunLineage } from './run-lineage.policy';

// 세션 키 · 작업 세션 · CLI 세션 재개 판단 (기획서 결정 2026-11-17)

const NOW = new Date('2026-11-17T10:00:00Z');
const CHAT = '0190a1b2-0000-7000-8000-000000000001';
const RUN = '0190a1b2-0000-7000-8000-000000000002';

function task(more: Partial<TaskRow> = {}): TaskRow {
  return {
    id: '0190a1b2-0000-7000-8000-0000000000aa',
    space_id: 's',
    agent_id: 'agent-1',
    kind: 'general',
    title: '산책 글',
    instruction: '',
    payload: {},
    result: null,
    target_kind: null,
    target_id: null,
    base_version: null,
    status: 'running',
    priority: 0,
    lease_until: new Date(NOW.getTime() + 60_000),
    leased_by: 'runner-1',
    attempts: 1,
    wait_until: null,
    request_id: 'req-1',
    version: 1,
    created_at: NOW,
    finished_at: null,
    goal_id: null,
    parent_id: null,
    depth: 0,
    wait_reason: null,
    rounds: 0,
    deleted_at: null,
    ...more,
  };
}

function run(more: Partial<TaskRunRow> = {}): TaskRunRow {
  return {
    id: 'run-1',
    space_id: 's',
    task_id: 't',
    seq: 1,
    runner_id: 'runner-1',
    agent_id: 'agent-1',
    agent_revision: 3,
    skill: null,
    skill_source: null,
    skill_revision: null,
    skill_hash: null,
    runner_build: null,
    cli_version: null,
    model: null,
    started_at: NOW,
    prompt_source: null,
    prompt_revision: null,
    prompt_hash: null,
    lineage: 'task:t',
    cli_session: 'cli-1',
    resumed: false,
    ...more,
  };
}

describe('RunLineage', () => {
  test('세션 키: 대화의 일은 대화 · 에이전트마다, 목표 실행은 실행마다, 나머지는 작업마다', () => {
    const turn = task({ payload: { chat: { chatId: CHAT, turn: 2 } } });
    assert.equal(RunLineage.of(turn), `chat:${CHAT}:agent-1`);
    const review = task({
      agent_id: 'reviewer',
      payload: { chat: { chatId: CHAT, review: true } },
    });
    assert.equal(RunLineage.of(review), `chat:${CHAT}:reviewer`, '검토자는 따로');
    assert.equal(RunLineage.of(task({ request_id: `goal-run:${RUN}:3` })), `goal-run:${RUN}`);
    const sub = task({ parent_id: 'p', request_id: 'delegate:p:x' });
    assert.equal(RunLineage.of(sub), `task:${sub.id}`, '하위 작업은 그 작업마다');
  });

  test('기록하지 않는 일: 에이전트 없는 일 · 세션 정리', () => {
    for (const kind of ['ai_test', 'ai_signin', 'session_note', 'tool_check'])
      assert.equal(RunLineage.of(task({ kind, agent_id: null })), null, kind);
    assert.equal(RunLineage.of(task({ kind: 'tidy_session' })), null);
  });

  test('작업 세션: 맨 위 작업의 대화 · 목표 실행 · 그 작업', () => {
    assert.equal(RunLineage.flowOf(task({ payload: { chat: { chatId: CHAT } } })), `chat:${CHAT}`);
    assert.equal(RunLineage.flowOf(task({ request_id: `goal-run:${RUN}:1` })), `goal-run:${RUN}`);
    const root = task();
    assert.equal(RunLineage.flowOf(root), `task:${root.id}`);
  });

  test('세션 파일을 남기는 일: 브라우저 · 샌드박스 일은 아니다', () => {
    assert.equal(RunLineage.keeps('general'), true);
    assert.equal(RunLineage.keeps('draft_post'), true);
    for (const kind of ['browse', 'code', 'make'])
      assert.equal(RunLineage.keeps(kind), false, kind);
  });

  test('재개 후보: 같은 러너 · 같은 에이전트 · 같은 설정 판이고 CLI 세션 id가 있을 때만', () => {
    const now = run({ id: 'run-2', seq: 2, cli_session: null }) as TaskRunNew;
    assert.equal(RunLineage.resumeOf(now, run(), true), 'cli-1');
    assert.equal(RunLineage.resumeOf(now, run(), false), null, '세션 파일을 남기지 않는 일');
    assert.equal(RunLineage.resumeOf(now, null, true), null, '앞 실행이 없다');
    assert.equal(RunLineage.resumeOf(now, run({ cli_session: null }), true), null);
    assert.equal(RunLineage.resumeOf(now, run({ runner_id: 'runner-2' }), true), null, '다른 러너');
    assert.equal(RunLineage.resumeOf(now, run({ agent_revision: 4 }), true), null, '설정이 바뀜');
    assert.equal(RunLineage.resumeOf(now, run({ agent_id: 'agent-2' }), true), null);
  });

  test('기록을 올릴 수 있는 작업: 그 러너가 잡았고 진행 중이거나 기다리며 점유 시간이 남았다', () => {
    RunLineage.assertRecordable(task(), 'runner-1', NOW);
    RunLineage.assertRecordable(
      task({ status: 'waiting', wait_reason: 'subtasks' }),
      'runner-1',
      NOW,
    );
    const refused = [
      task({ leased_by: 'runner-2' }),
      task({ status: 'done' }),
      task({ status: 'queued' }),
      task({ lease_until: new Date(NOW.getTime() - 1) }),
      task({ lease_until: null }),
    ];
    for (const t of refused)
      assert.throws(() => RunLineage.assertRecordable(t, 'runner-1', NOW), RuleViolation);
  });

  test('끝난 요청 (S2): 완료면 정리, 실패 · 취소면 원문으로만, 대화는 가라앉고 카드를 기다리지 않을 때만', () => {
    const chat = { chat: { chatId: 'c1' } };
    const cases: [Partial<TaskRow>, boolean, boolean, boolean | null][] = [
      [{ status: 'done' }, true, false, true],
      [{ status: 'failed' }, true, false, false],
      [{ status: 'cancelled' }, true, false, false],
      [{ status: 'running' }, true, false, null],
      [{ status: 'done' }, false, false, null],
      [{ status: 'done', parent_id: 'top' }, true, false, null],
      [{ status: 'done', payload: chat }, true, true, null],
      [{ status: 'done', payload: chat }, true, false, true],
      [{ status: 'done' }, true, true, true],
    ];
    for (const [more, recorded, open, want] of cases)
      assert.equal(RunLineage.settledOf(task(more), recorded, open), want, JSON.stringify(more));
    assert.equal(RunLineage.flowOf(task({ payload: chat })), RunLineage.chatFlow('c1'));
    assert.deepEqual(
      ['approved', 'rejected', 'cancelled', 'revision_requested', 'pending'].map((s) =>
        RunLineage.settledCard(s),
      ),
      [true, false, false, null, null],
    );
  });
});
