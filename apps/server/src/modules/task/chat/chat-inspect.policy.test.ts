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

  test('고쳐 왔는데 점수가 오르지 않으면 한도 전이라도 관리자에게 (2026-11-20)', () => {
    const scored = (score: number) =>
      ChatReview.parse(
        JSON.stringify({
          verdict: 'fix',
          summary: '까닭',
          checklist: [{ item: '제목', score, note: '흔함' }],
          fixes: ['제목'],
        }),
      );
    assert.equal(ChatInspect.outcome(scored(3), 1, 2), 'fix', '올랐으면 다시');
    assert.equal(ChatInspect.outcome(scored(3), 1, 3), 'hold', '같으면 넘김');
    assert.equal(ChatInspect.outcome(scored(2), 1, 3), 'hold', '내려가도 넘김');
    assert.equal(ChatInspect.outcome(scored(3), 0, null), 'fix', '앞 점수가 없으면 모른다');
    assert.equal(
      ChatInspect.opinion(scored(3), 'hold', 3),
      '고쳐도 점수가 오르지 않음 (3점 → 3점): 제목 (까닭)',
    );
    assert.equal(
      ChatInspect.opinion(scored(3), 'fix'),
      '검수 의견 (평균 3점): 까닭\n고칠 것:\n- 제목',
    );
  });

  test('두 검수자 (2026-11-20): 둘 다 통과해야 통과, 하나라도 고칠 것이면 고칠 것(합침), 반려가 먼저, 못 끝냈으면 null', () => {
    const scored = (verdict: string, score: number, fixes: string[] = []) =>
      ChatReview.parse(
        JSON.stringify({ verdict, summary: verdict, checklist: [{ item: '조건', score }], fixes }),
      );
    const pass = ChatInspect.combine([scored('pass', 5), scored('pass', 4)]);
    assert.deepEqual(
      [pass?.verdict, pass?.score, pass?.summary],
      ['pass', 4, '검수 1: pass / 검수 2: pass'],
    );
    const fix = ChatInspect.combine([scored('pass', 5), scored('fix', 3, ['제목'])]);
    assert.deepEqual([fix?.verdict, fix?.fixes, fix?.score], ['fix', ['제목'], 3]);
    assert.equal(
      ChatInspect.combine([scored('fix', 3, ['제목']), scored('reject', 1)])?.verdict,
      'reject',
    );
    assert.equal(ChatInspect.combine([scored('pass', 5), null]), null, '하나가 끝내지 못함');
    assert.equal(
      ChatInspect.combine([scored('pass', 5)])?.verdict,
      'pass',
      '검수자가 하나면 그대로',
    );
    assert.equal(
      ChatInspect.combine([scored('pass', 5), ChatReview.parse('그냥 글')])?.verdict,
      'unknown',
    );
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
