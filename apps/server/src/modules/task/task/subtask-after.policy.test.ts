import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import { type AfterOrderRow, type AfterSiblingRow, SubtaskAfter } from './subtask-after.policy';
import { SubtaskOrder } from './subtask-order.input';

// 순서가 있는 위임 (D2 after, 2026-11-21): 나누기 · 적어 두기 · 앞 단계가 끝났는지 · 넘길 결과
const AGENT = '01900000-0000-7000-8000-000000000001';
const order = (id: string, after: string[] = []) =>
  SubtaskOrder.saved({
    request_id: id,
    to_agent_id: AGENT,
    title: `${id} 일`,
    instruction: '해 주세요',
    ...(after.length > 0 ? { after } : {}),
  });
const sibling = (key: string, status: string, text?: string): AfterSiblingRow =>
  ({
    id: `task-${key}`,
    request_id: key,
    status,
    title: `${key} 일`,
    result: text === undefined ? null : { text },
  }) as AfterSiblingRow;
const held = (key: string, after: string[]): AfterOrderRow => ({ key, after, order: {} });

describe('나누기', () => {
  test('after가 없으면 바로, 있으면 나중에', () => {
    const { now, later } = SubtaskAfter.split([order('a'), order('b'), order('c', ['a', 'b'])]);
    assert.deepEqual(
      now.map((o) => o.requestId),
      ['a', 'b'],
    );
    assert.deepEqual(
      later.map((o) => o.requestId),
      ['c'],
    );
    assert.deepEqual(later[0]?.after, ['a', 'b']);
  });

  test('after는 같은 호출에서 앞에 적은 것만 (뒤 · 없는 것 · 자기 자신은 거절)', () => {
    assert.throws(() => SubtaskAfter.split([order('a', ['b']), order('b')]), RuleViolation);
    assert.throws(() => SubtaskAfter.split([order('a'), order('b', ['x'])]), RuleViolation);
    assert.throws(() => SubtaskAfter.split([order('a', ['a'])]), RuleViolation);
  });

  test('적어 둔 모양은 받은 그대로 다시 읽힌다', () => {
    const later = order('b', ['a']);
    const again = SubtaskOrder.saved(later.raw);
    assert.equal(again.requestId, 'b');
    assert.deepEqual(again.after, ['a']);
    assert.equal(again.fields.title, 'b 일');
  });
});

describe('적어 두기', () => {
  test('열쇠는 위 작업마다 센 request_id, 이미 적은 것에 더한다 · 다 시작하면 칸을 뺀다', () => {
    const key = (id: string) => `p:${id}`;
    const first = SubtaskAfter.hold({ plan: 1 }, [order('b', ['a'])], key);
    assert.deepEqual(SubtaskAfter.held(first), [
      { key: 'p:b', after: ['p:a'], order: order('b', ['a']).raw },
    ]);
    const second = SubtaskAfter.hold(first, [order('d', ['c'])], key);
    assert.equal(SubtaskAfter.held(second).length, 2);
    assert.deepEqual(SubtaskAfter.withRest(second, []), { plan: 1 });
    assert.deepEqual(SubtaskAfter.held(SubtaskAfter.withRest(second, [held('p:d', ['p:c'])])), [
      held('p:d', ['p:c']),
    ]);
    assert.deepEqual(SubtaskAfter.held(null), []);
    assert.deepEqual(SubtaskAfter.held({ afterOrders: 'x' }), []);
  });
});

describe('앞 단계가 끝났는지', () => {
  test('모두 끝나면 ready, 하나라도 실패 · 취소면 dropped, 아니면 기다린다', () => {
    const items = [held('c', ['a', 'b']), held('d', ['a']), held('e', ['x']), held('f', ['b'])];
    const plan = SubtaskAfter.due(items, [sibling('a', 'done'), sibling('b', 'running')]);
    assert.deepEqual(
      plan.ready.map((i) => i.key),
      ['d'],
    );
    assert.deepEqual(
      plan.rest.map((i) => i.key),
      ['c', 'e', 'f'],
    );
    const failed = SubtaskAfter.due(items, [sibling('a', 'done'), sibling('b', 'failed')]);
    assert.deepEqual(
      failed.dropped.map((i) => i.key),
      ['c', 'f'],
    );
    const cancelled = SubtaskAfter.due([held('c', ['a'])], [sibling('a', 'cancelled')]);
    assert.equal(cancelled.dropped.length, 1);
  });

  test('넘길 결과: 앞 단계의 제목과 결과 글 (3000자까지)', () => {
    const long = '가'.repeat(SubtaskAfter.RESULT_MAX + 10);
    const results = SubtaskAfter.results(held('c', ['a', 'b']), [
      sibling('a', 'done', '조사 결과'),
      sibling('b', 'done', long),
    ]);
    assert.deepEqual(results[0], { taskId: 'task-a', title: 'a 일', text: '조사 결과' });
    assert.equal(results[1]?.text.length, SubtaskAfter.RESULT_MAX);
    assert.deepEqual(SubtaskAfter.results(held('c', ['a']), [sibling('a', 'done')])[0]?.text, '');
  });
});
