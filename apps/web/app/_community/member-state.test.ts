import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockNotice, waitNotice } from './member-state.ts';
import type { MemberSelf } from './types.ts';

const NOW = Date.parse('2026-11-19T03:00:00.000Z');
const member = {
  id: 'm1',
  loginId: 'reader',
  nickname: '읽는사람',
  joinedAt: '2026-11-19T02:58:00.000Z',
  writableAt: '2026-11-19T03:03:00.000Z',
  blockedUntil: null,
  version: 1,
} satisfies MemberSelf;

test('가입 대기: 끝나는 때까지만 (한국 시간)', () => {
  assert.match(waitNotice(member, NOW) ?? '', /11월 19일 오후 12:03부터 글 · 댓글/);
  assert.equal(waitNotice(member, Date.parse(member.writableAt)), null);
});

test('차단: 기한이 있으면 그날까지, 무기한, 지난 차단은 없다', () => {
  const until = { ...member, blockedUntil: '2026-11-26T03:00:00.000Z' };
  assert.match(blockNotice(until, NOW) ?? '', /11월 26일 오후 12:00까지 쓰기를 막았어요/);
  assert.equal(
    blockNotice({ ...member, blockedUntil: '9999-12-31T00:00:00.000Z' }, NOW),
    '운영자가 쓰기를 막았어요 (기한 없음)',
  );
  assert.equal(blockNotice({ ...member, blockedUntil: '2026-11-18T00:00:00.000Z' }, NOW), null);
  assert.equal(blockNotice(member, NOW), null);
});
