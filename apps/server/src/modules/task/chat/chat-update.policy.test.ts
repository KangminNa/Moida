import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type ChatPlaceRow, ChatUpdates } from './chat-update.policy';
import { TurnDeliver } from './turn-deliver.policy';

// 끝난 작업이 남기는 소식 중 관리자에게 돌아가는 말(said)과, 메일로 받는 자동화의 회차(mail, 2026-11-27)

const place = (more: Partial<ChatPlaceRow>, chat: Record<string, unknown> = {}): ChatPlaceRow => ({
  id: 't1',
  root_id: 't1',
  status: 'done',
  result: { text: '요약했어요' },
  title: '대화 · 아침 요약',
  agent_id: 'a1',
  space_id: 's1',
  chat_id: 'c1',
  payload: { chat: { chatId: 'c1', turn: 1, ...chat } },
  ...more,
});

describe('ChatUpdates.settled 메일로 받기', () => {
  test('메일로 받는 회차의 최종 답 · 실패는 mail, 아닌 회차는 없음', () => {
    assert.equal(ChatUpdates.settled(place({}, { mail: true }))?.said?.mail, true);
    const failed = ChatUpdates.settled(
      place({ status: 'failed', result: { error: '시간 초과' } }, { mail: true }),
    );
    assert.deepEqual([failed?.kind, failed?.said?.mail], ['failed', true]);
    assert.equal(ChatUpdates.settled(place({}))?.said?.mail, false);
  });

  test('덧붙인 말의 답 · 팀원의 일은 메일로 보내지 않는다', () => {
    assert.equal(ChatUpdates.settled(place({}, { mail: true, reply: true }))?.said?.mail, false);
    const member = ChatUpdates.settled(place({ id: 't2', payload: { chat: { mail: true } } }));
    assert.deepEqual([member?.kind, member?.said?.mail], ['member_done', undefined]);
  });

  test('TurnDeliver.mailOf: 서버가 다시 맡긴 회차가 앞 회차에서 물려받는 값', () => {
    assert.equal(TurnDeliver.mailOf({ chat: { mail: true } }), true);
    assert.equal(TurnDeliver.mailOf({ chat: {} }), false);
    assert.equal(TurnDeliver.mailOf(null), false);
    assert.deepEqual(TurnDeliver.carry({ chat: { deliver: 'html', mail: true } }), {
      deliver: 'html',
      mail: true,
    });
  });
});
