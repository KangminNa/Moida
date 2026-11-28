import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SubtaskVerify, type VerifyRow } from './subtask-verify.policy';

// 검증 루프 (L2): 끝난 하위 작업에서 다음 할 일 · 검증할 일꾼 고르기
const member = (
  id: string,
  tool: 'claude' | 'codex' = 'claude',
  more: Record<string, unknown> = {},
) => ({
  id,
  lead: false,
  deleted: false,
  paused: false,
  tool,
  reviewerId: null as string | null,
  ...more,
});
const row = (payload: Record<string, unknown>, text = '결과', agent = 'w1'): VerifyRow => ({
  id: 't1',
  agent_id: agent,
  kind: 'general',
  title: '조사',
  instruction: '후보 셋',
  payload,
  result: { text },
  request_id: 'r',
});

test('검증할 일꾼: 검토자 짝 → 다른 AI 도구 → 다른 일꾼, 대표 · 맡은 일꾼 · 멈춘 일꾼은 빼고', () => {
  const lead = member('lead', 'codex', { lead: true });
  const worker = member('w1', 'claude', { reviewerId: 'w3' });
  const org = [lead, worker, member('w2', 'codex'), member('w3', 'claude')];
  assert.equal(SubtaskVerify.pickVerifier('w1', org)?.id, 'w3', '검토자 짝이 먼저');
  const noPair = [lead, member('w1'), member('w2', 'claude'), member('w4', 'codex')];
  assert.equal(SubtaskVerify.pickVerifier('w1', noPair)?.id, 'w4', '다른 AI 도구');
  assert.equal(SubtaskVerify.pickVerifier('w1', [lead, member('w1')]), null, '검증할 일꾼이 없다');
  assert.equal(
    SubtaskVerify.pickVerifier('w1', [member('w1'), member('w2', 'codex', { paused: true })]),
    null,
  );
});

test('verify면 검증 일, 검증의 fix면 같은 일꾼에게 다시, pass · 한도 · 점수가 오르지 않음이면 끝', () => {
  const org = [member('w1'), member('w2', 'codex')];
  assert.equal(SubtaskVerify.next(row({}), org).kind, 'none', 'verify가 아니면 그대로');
  const step = SubtaskVerify.next(row({ verify: true, deliver: '표로' }), org);
  assert.equal(step.kind, 'verify');
  if (step.kind !== 'verify') return;
  assert.equal(step.order.to_agent_id, 'w2');
  assert.equal(step.order.request_id, 'verify:t1');
  assert.deepEqual((step.seed.check as Record<string, unknown>).deliver, '표로');

  const fix = JSON.stringify({
    verdict: 'fix',
    summary: '출처 없음',
    checklist: [{ item: '출처', score: 2 }],
    fixes: ['출처 주소를 단다'],
  });
  const check = (round: number, lastScore: number | null, text = fix) =>
    row(
      { verifyOf: 't1', round, check: { ...(step.seed.check as object), lastScore } },
      text,
      'w2',
    );
  const retry = SubtaskVerify.next(check(1, null), org);
  assert.equal(retry.kind, 'retry');
  if (retry.kind !== 'retry') return;
  assert.deepEqual(
    [retry.order.to_agent_id, retry.order.request_id, retry.seed.round, retry.seed.lastScore],
    ['w1', 'retry:t1:2', 2, 2],
  );
  assert.deepEqual((retry.seed.fixNote as Record<string, unknown>).fixes, ['출처 주소를 단다']);
  assert.equal(SubtaskVerify.next(check(3, null), org).kind, 'none', '3번까지');
  assert.equal(SubtaskVerify.next(check(2, 2), org).kind, 'none', '점수가 오르지 않으면 멈춤');
  const pass = JSON.stringify({ verdict: 'pass', checklist: [{ item: '출처', score: 5 }] });
  assert.equal(SubtaskVerify.next(check(1, null, pass), org).kind, 'none');
});
