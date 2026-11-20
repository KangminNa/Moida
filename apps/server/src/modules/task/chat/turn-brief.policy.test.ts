import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TurnBrief, type TurnBriefRow } from './turn-brief.policy';

// 목표 확인 질문 (2026-11-20): 대표의 새 회차에서 한 번, 답한 회차 · 자동화 · 다시 맡긴 회차 · 덧붙인 말의 답에서는 아님

const BRIEF: TurnBriefRow = {
  summary: '신제품 소개 페이지',
  questions: [
    { text: '누가 보나요?', why: '말투가 바뀐다', choices: ['고객', '투자자'], suggested: '고객' },
  ],
};
const turn = (chat: Record<string, unknown>) => ({ chat: { chatId: 'c1', turn: 1, ...chat } });

describe('TurnBrief', () => {
  test('대표의 새 회차에서 한 번 묻고, 물은 회차는 asked', () => {
    const asked = TurnBrief.declare(turn({ requestId: 'r1' }), BRIEF, false);
    assert.equal(TurnBrief.asked(asked), true);
    assert.equal(TurnBrief.asked(turn({})), false);
    assert.throws(() => TurnBrief.declare(asked, BRIEF, false), /이미 물었어요/);
    assert.equal(TurnBrief.news(BRIEF), '목표를 확인할 것 1개를 물었어요: 신제품 소개 페이지');
  });

  test('묻지 않는 회차: 답한 회차 · 자동화 · 서버가 다시 맡긴 회차 · 덧붙인 말의 답 · 검토 · 대화 밖', () => {
    assert.throws(() => TurnBrief.declare(turn({}), BRIEF, true), /질문에 답한 회차/);
    assert.throws(
      () => TurnBrief.declare(turn({ requestId: 'schedule:s1:2026-11-20T00:00' }), BRIEF, false),
      /자동화 회차/,
    );
    assert.throws(() => TurnBrief.declare(turn({ fix: true }), BRIEF, false), /다시 맡긴/);
    for (const extra of [{ reply: true }, { review: true }])
      assert.throws(() => TurnBrief.declare(turn(extra), BRIEF, false), /대표만/);
    assert.throws(() => TurnBrief.declare({}, BRIEF, false), /대표만/);
    assert.throws(
      () => TurnBrief.declare(turn({}), { ...BRIEF, questions: [] }, false),
      /하나 이상/,
    );
  });
});
