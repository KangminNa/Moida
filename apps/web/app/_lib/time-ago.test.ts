import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ago } from './time-ago.ts';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const before = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('지난 길이: 방금 · 분 · 시간 · 일, 30일이 넘으면 날짜', () => {
  assert.equal(ago(before(20_000), NOW), '방금');
  assert.equal(ago(before(5 * MIN), NOW), '5분 전');
  assert.equal(ago(before(59 * MIN + 59_000), NOW), '59분 전');
  assert.equal(ago(before(3 * HOUR + 10 * MIN), NOW), '3시간 전');
  assert.equal(ago(before(2 * DAY), NOW), '2일 전');
  assert.equal(ago(before(30 * DAY), NOW), '30일 전');
  assert.match(ago(before(45 * DAY), NOW), /2026/);
  // 시계가 어긋나 앞선 시각이어도 음수가 아니라 방금
  assert.equal(ago(before(-30_000), NOW), '방금');
});
