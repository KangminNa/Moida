import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Conflict, Forbidden, RuleViolation } from '../../platform';
import { SubtaskWait } from './subtask-wait.policy';

// 팀원 기다리기의 규칙 (2026-11-19): 기한 · 깨울 까닭 · 재촉
const NOW = new Date('2026-11-19T10:00:00Z');
const minutes = (until: Date) => (until.getTime() - NOW.getTime()) / 60_000;

describe('기한', () => {
  test('고르면 그 분, 아니면 맡긴 일 가운데 가장 긴 종류 (보통 15 · 브라우저 20 · 만들기 30 · 코드 40)', () => {
    assert.equal(minutes(SubtaskWait.until(NOW, 7, ['code'])), 7);
    assert.equal(minutes(SubtaskWait.until(NOW, null, ['general'])), 15);
    assert.equal(minutes(SubtaskWait.until(NOW, null, ['general', 'browse'])), 20);
    assert.equal(minutes(SubtaskWait.until(NOW, null, ['make', 'code'])), 40);
    assert.equal(minutes(SubtaskWait.until(NOW, null, [])), 15);
    assert.equal(minutes(SubtaskWait.soon(NOW)) * 60, 10, '남은 것이 없으면 10초 뒤');
  });

  test('지났는지', () => {
    assert.equal(SubtaskWait.overdue(null, NOW), false);
    assert.equal(SubtaskWait.overdue(new Date(NOW.getTime() + 1), NOW), false);
    assert.equal(SubtaskWait.overdue(NOW, NOW), true);
  });
});

describe('깨울 까닭', () => {
  test('모두 끝나면 all, 남았는데 실패면 failed, 남았는데 완료 · 취소면 계속 기다린다', () => {
    assert.equal(SubtaskWait.wakeOn('done', 0), 'all');
    assert.equal(SubtaskWait.wakeOn('failed', 0), 'all');
    assert.equal(SubtaskWait.wakeOn('failed', 2), 'failed');
    assert.equal(SubtaskWait.wakeOn('done', 1), null);
    assert.equal(SubtaskWait.wakeOn('cancelled', 1), null);
  });

  test('깬 까닭은 payload.wake에, 기록의 글은 까닭마다', () => {
    assert.deepEqual(SubtaskWait.woken({ chat: { turn: 1 } }, 'deadline'), {
      chat: { turn: 1 },
      wake: 'deadline',
    });
    assert.match(SubtaskWait.noteOf('owner'), /관리자/);
    assert.match(SubtaskWait.noteOf('모름'), /모두 끝나/);
  });
});

describe('재촉 · 더 기다리기', () => {
  test('재촉은 대기 · 실행 · 하위 작업 기다림에만 (승인 기다림 · 끝난 일은 409)', () => {
    for (const row of [
      { status: 'queued', wait_reason: null },
      { status: 'running', wait_reason: null },
      { status: 'waiting', wait_reason: 'subtasks' },
    ] as const)
      SubtaskWait.assertHurriable(row);
    for (const row of [
      { status: 'waiting', wait_reason: 'approval' },
      { status: 'done', wait_reason: null },
    ] as const)
      assert.throws(() => SubtaskWait.assertHurriable(row), Conflict);
  });

  test('재촉한 작업은 더 맡기거나 기다리지 못하고, 남은 일을 모두 취소하며 기다리면 마무리하라고 한다', () => {
    assert.throws(() => SubtaskWait.assertNotHurried({ wake: 'owner' }), RuleViolation);
    SubtaskWait.assertNotHurried({ wake: 'deadline' });
    SubtaskWait.assertNotHurried(null);
    assert.throws(() => SubtaskWait.assertLeft(0, 2), RuleViolation);
    SubtaskWait.assertLeft(0, 0);
    SubtaskWait.assertLeft(1, 1);
  });
});

describe('도움 요청 (ask_help, 2026-11-20)', () => {
  const row = { agent_id: 'a', status: 'running' as const, parent_id: 'p' };
  test('팀장이 맡긴, 지금 도는 내 일에서만', () => {
    SubtaskWait.assertHelpable(row, 'a', true);
    assert.throws(() => SubtaskWait.assertHelpable(row, 'b', true), Forbidden);
    assert.throws(() => SubtaskWait.assertHelpable(row, 'a', false), Conflict, '임대가 끝남');
    assert.throws(
      () => SubtaskWait.assertHelpable({ ...row, status: 'waiting' }, 'a', true),
      Conflict,
    );
    assert.throws(
      () => SubtaskWait.assertHelpable({ ...row, parent_id: null }, 'a', true),
      RuleViolation,
      '맨 위 일',
    );
  });

  test('일 하나에 HELP_MAX번, 기록 줄은 머리말로 알아본다', () => {
    SubtaskWait.assertHelpLeft(SubtaskWait.HELP_MAX - 1);
    assert.throws(() => SubtaskWait.assertHelpLeft(SubtaskWait.HELP_MAX), RuleViolation);
    assert.ok(SubtaskWait.helpLine('  절반  ').startsWith(SubtaskWait.HELP_PREFIX));
  });
});
