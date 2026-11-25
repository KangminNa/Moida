import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampRatio, mainChatOf, SIDE_RATIO, sideChatOf, withSide } from './chat-panes.ts';

// 대화 화면 나누기 (2026-11-25)

const A = '01900000-0000-7000-8000-000000000001';
const B = '01900000-0000-7000-8000-000000000002';

test('옆 대화는 대화 id 모양이고 크게 보는 대화와 다를 때만', () => {
  assert.equal(mainChatOf(`/admin/chats/${A}`), A);
  assert.equal(mainChatOf('/admin'), null);
  assert.equal(mainChatOf('/admin/chats/trash'), 'trash');
  assert.equal(sideChatOf(B, A), B);
  assert.equal(sideChatOf(A, A), null, '같은 대화를 둘로 열지 않는다');
  assert.equal(sideChatOf('../../api', null), null, '모양이 다른 값');
  assert.equal(sideChatOf(null, A), null);
});

test('주소에 옆 대화를 붙이고 떼고, 너비 몫은 범위 안으로', () => {
  assert.equal(withSide('/admin', B), `/admin?side=${B}`);
  assert.equal(withSide(`/admin/chats/${A}`, null), `/admin/chats/${A}`);
  assert.equal(clampRatio(0.9), SIDE_RATIO.max);
  assert.equal(clampRatio(0.1), SIDE_RATIO.min);
  assert.equal(clampRatio(Number.NaN), SIDE_RATIO.initial);
  assert.equal(clampRatio(0.42), 0.42);
});
