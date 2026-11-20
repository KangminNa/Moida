import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import { TaskPlan } from './task-plan.policy';

// 큰 일은 계획 먼저 (2026-11-20): 한 번만 정하고, 검토 · 검수는 다시 맡긴 회차를 거슬러 처음 계획으로 판정한다

const plan = (criteria: string[], steps = ['조사 → 자료 조사'], mustNot: string[] = []) => ({
  steps,
  criteria,
  mustNot,
});
const turn = (payload: Record<string, unknown>) => ({ payload });

describe('TaskPlan', () => {
  test('한 번만 정하고 (완료 조건은 바꿀 수 없다), 완료 조건이 없으면 받지 않는다', () => {
    const once = TaskPlan.declare({ chat: { turn: 1 } }, plan(['표에 5개']));
    assert.deepEqual(TaskPlan.of(once)?.criteria, ['표에 5개']);
    assert.deepEqual((once as { chat: unknown }).chat, { turn: 1 }, '다른 칸은 그대로');
    assert.throws(() => TaskPlan.declare(once, plan(['다른 조건'])), RuleViolation);
    assert.throws(() => TaskPlan.declare({}, plan([])), RuleViolation);
    assert.equal(TaskPlan.of({ plan: { criteria: [] } }), null, '모양이 틀리면 없음');
  });

  test('다시 맡긴 회차를 거슬러 그 줄의 가장 먼저 정한 계획 (새로 정해도 처음 것), 줄 밖의 회차는 보지 않는다', () => {
    const first = TaskPlan.declare({ chat: {} }, plan(['처음 조건']));
    const again = TaskPlan.declare({ chat: { fix: true } }, plan(['바꾼 조건']));
    assert.deepEqual(TaskPlan.inTurns([turn(first), turn(again)])?.criteria, ['처음 조건']);
    assert.deepEqual(TaskPlan.inTurns([turn(first), turn({ chat: { fix: true } })])?.criteria, [
      '처음 조건',
    ]);
    assert.equal(TaskPlan.inTurns([turn(first), turn({ chat: {} })]), null, '새 회차는 새 일');
    assert.equal(TaskPlan.inTurns([]), null);
  });

  test('지시문의 자리와 대화 소식', () => {
    const p = plan(['표에 5개', '출처 링크'], ['조사', '정리'], ['메일 보내기']);
    assert.deepEqual(TaskPlan.fields(p), {
      criteria: '- 표에 5개\n- 출처 링크',
      mustNot: '- 메일 보내기',
    });
    assert.deepEqual(TaskPlan.fields(null), { criteria: null, mustNot: null });
    assert.equal(
      TaskPlan.note(p),
      '계획을 정했어요\n단계\n- 조사\n- 정리\n완료 조건\n- 표에 5개\n- 출처 링크\n하지 말 것\n- 메일 보내기',
    );
  });
});
