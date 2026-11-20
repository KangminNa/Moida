import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Agent } from '../agent/agent';
import { ChatInspect } from './chat-inspect.policy';
import { ChatReview } from './chat-review.policy';

// 검수의 판단 (2026-11-20): 판정 → 결정, 결재에 남길 말, 검수자가 올린 쪽 밖인지
const member = (id: string, reportsTo: string | null) => ({ id, reportsTo }) as unknown as Agent;
const review = (verdict: string, fixes: string[] = [], summary = '까닭') =>
  ChatReview.parse(JSON.stringify({ verdict, summary, fixes }));

describe('ChatInspect', () => {
  test('통과는 승인, 고칠 것은 FIX_MAX번까지 돌려보내고, 그 밖은 관리자에게', () => {
    assert.equal(ChatInspect.outcome(review('pass'), 0), 'pass');
    assert.equal(ChatInspect.outcome(review('fix', ['제목']), 0), 'fix');
    assert.equal(ChatInspect.outcome(review('fix', ['제목']), ChatInspect.FIX_MAX - 1), 'fix');
    assert.equal(ChatInspect.outcome(review('fix', ['제목']), ChatInspect.FIX_MAX), 'hold');
    assert.equal(ChatInspect.outcome(review('fix', []), 0), 'hold', '무엇을 고칠지 모르면');
    assert.equal(ChatInspect.outcome(review('reject'), 0), 'hold');
    assert.equal(ChatInspect.outcome(ChatReview.parse('그냥 글'), 0), 'hold');
    assert.equal(ChatInspect.outcome(null, 0), 'hold', '검수를 끝내지 못함');
  });

  test('결재에 남길 말', () => {
    assert.equal(ChatInspect.opinion(review('pass'), 'pass'), '까닭');
    assert.equal(
      ChatInspect.opinion(review('fix', ['제목', '끝맺음']), 'fix'),
      '검수 의견: 까닭\n고칠 것:\n- 제목\n- 끝맺음',
    );
    assert.match(ChatInspect.opinion(review('fix', ['제목']), 'hold'), /^3번 고쳐도 남음: 제목/);
    assert.equal(ChatInspect.opinion(review('reject'), 'hold'), '반려 권함 · 까닭');
    assert.equal(ChatInspect.opinion(null, 'hold'), '검수를 끝내지 못했어요');
  });

  test('검수자는 올린 에이전트도, 그 위도, 그 아래도 아니어야 한다', () => {
    const agents = [
      member('boss', null),
      member('writer', 'boss'),
      member('helper', 'writer'),
      member('outside', null),
    ];
    const [boss, writer, helper, outside] = agents as [Agent, Agent, Agent, Agent];
    assert.equal(ChatInspect.independent(outside, 'writer', agents), true);
    assert.equal(ChatInspect.independent(writer, 'writer', agents), false, '자기 일');
    assert.equal(ChatInspect.independent(boss, 'writer', agents), false, '팀장이 제 팀의 일');
    assert.equal(ChatInspect.independent(helper, 'writer', agents), false, '팀원이 팀장의 일');
    assert.equal(ChatInspect.independent(outside, null, agents), false, '올린 쪽을 모름');
    assert.equal(ChatInspect.independent(boss, 'outside', agents), true);
  });
});
