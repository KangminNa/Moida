import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AgentRole } from '../agent/agent-role.policy';
import { TeamReview, type TeamReviewRow } from './team-review.policy';

// 주간 팀 점검 (2026-11-20): 7일 간격 · 끝난 일 10개 · 열린 점검이 없을 때, 팀원마다 두 줄(누구 · 성적표)

const NOW = new Date('2026-11-20T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('TeamReview', () => {
  test('맡길 때: 지난 점검(처음이면 대표가 생긴 때)이 7일 넘었고, 그동안 끝난 일이 10개 이상, 열린 점검이 없음', () => {
    const old = daysAgo(30);
    assert.equal(TeamReview.due(null, 10, NOW, old), true);
    assert.equal(TeamReview.due(null, 10, NOW, daysAgo(2)), false, '막 만든 팀은 일주일 뒤부터');
    assert.equal(TeamReview.due(null, 9, NOW, old), false, '일이 적으면 점검할 거리가 없다');
    assert.equal(TeamReview.due({ status: 'done', created_at: daysAgo(8) }, 12, NOW, old), true);
    assert.equal(TeamReview.due({ status: 'done', created_at: daysAgo(3) }, 50, NOW, old), false);
    assert.equal(
      TeamReview.due({ status: 'queued', created_at: daysAgo(30) }, 50, NOW, old),
      false,
    );
    // 세기 시작: 지난 점검과 7일 전 가운데 늦은 쪽
    assert.deepEqual(TeamReview.since(null, NOW), daysAgo(7));
    assert.deepEqual(TeamReview.since({ created_at: daysAgo(2) }, NOW), daysAgo(2));
    assert.equal(TeamReview.requestId('s', NOW), 'team-review:s:2026-11-20');
  });

  test('팀원 줄: 역할 첫 줄 · 도구와 모델 · 보고 대상, 성적표가 없으면 판정 없음', () => {
    const row = (more: Partial<TeamReviewRow>): TeamReviewRow => ({
      id: 'a1',
      name: '작가',
      role: '초안을 쓴다\n- 둘째 줄',
      tool: 'claude',
      model: 'sonnet',
      status: 'active',
      boss: '편집장',
      open: 1,
      ...more,
    });
    const score = {
      agent_id: 'a1',
      judged: 5,
      first_pass: 2,
      avg_fixes: 1.4,
      decided: 4,
      sent_back: 1,
      done: 9,
      tokens_per_done: 3000,
    };
    const { members, days } = TeamReview.fields(
      [row({}), row({ id: 'a2', name: '조사', model: '', boss: null, status: 'paused' })],
      [score],
      30,
    );
    assert.equal(days, 30);
    assert.equal(
      members,
      [
        '- 작가 (agent_id: a1) · 초안을 쓴다 · AI 도구 claude · 모델 sonnet · 보고: 편집장',
        '  끝낸 일 9 · 쥔 일 1 · 첫 판정 통과 2/5 · 평균 고친 횟수 1.4 · 관리자 반려 · 고쳐 달라 1/4 · 일 하나에 토큰 3000',
        `  역할 설명에 빠진 것: ${AgentRole.SECTIONS.join(' · ')}`,
        '- 조사 (agent_id: a2) · 초안을 쓴다 · AI 도구 claude · 보고: 관리자 · 멈춤',
        '  끝낸 일 0 · 쥔 일 1 · 판정 없음',
        `  역할 설명에 빠진 것: ${AgentRole.SECTIONS.join(' · ')}`,
      ].join('\n'),
    );
    assert.equal(TeamReview.fields([], [], 30).members, '- 없음');

    // 팀원이 많으면 일이 많은 순으로 MEMBERS_MAX명만 싣고 나머지는 수만 (지시문 한도 20,000자)
    const many = Array.from({ length: TeamReview.MEMBERS_MAX + 5 }, (_, i) =>
      row({ id: `m${i}`, name: `팀원${i}`, open: 0 }),
    );
    const busiest = { ...score, agent_id: `m${many.length - 1}`, done: 40 };
    const crowd = String(TeamReview.fields(many, [busiest], 30).members);
    assert.match(crowd, new RegExp(`^- 팀원${many.length - 1} `), '일이 가장 많은 팀원이 먼저');
    assert.equal(crowd.match(/^- 팀원/gm)?.length, TeamReview.MEMBERS_MAX);
    assert.match(crowd, /\n- 그 밖에 5명 \(일이 적어 뺐다/);
  });
});
