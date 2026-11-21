import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Agent } from '../agent/agent';
import { TeamRoster } from './team-roster';

// 일꾼 정보 (D1): 대표는 모든 일꾼의 일 수 · 커넥터 · 성적표를 본다 (팀은 2026-11-21에 없앴다). DB 없이 돈다.

const NOW = new Date('2026-11-17T00:00:00Z');

function org() {
  const make = (name: string, tool = 'claude') => Agent.open('space', { name, tool }, NOW);
  const boss = Agent.openLead('space', 'claude', NOW);
  const writer = make('글쓰기', 'codex');
  const finder = make('조사');
  return { boss, writer, finder, all: [boss, writer, finder] };
}

/** 성적표가 없는 일꾼 (2026-11-20) */
const ZERO = { scorecard: null };

describe('일꾼 정보 (TeamRoster)', () => {
  test('대표는 일꾼마다 일 수 · 도구 · 커넥터 · 성적표를 본다. 맡길 수 있는 일은 모두 같다', () => {
    const { boss, writer, finder, all } = org();
    const roster = new TeamRoster(all, [
      {
        ...ZERO,
        agent_id: writer.id,
        open: 2,
        done: 5,
        failed: 1,
        revised: 1,
        connectors: ['notion'],
        scorecard: {
          judged: 4,
          first_pass: 3,
          avg_fixes: 0.25,
          decided: 5,
          sent_back: 1,
          tokens_per_done: 1200,
        },
      },
    ]);
    const members = roster.members(boss).map((m) => m.toJSON());
    assert.deepEqual(
      members.map((m) => m.name),
      ['글쓰기', '조사'],
    );
    const [head, second] = members;
    assert.equal(head?.open, 2);
    assert.equal(head?.tool, 'codex');
    assert.deepEqual(head?.recent, { done: 5, failed: 1, revised: 1 });
    assert.deepEqual(head?.scorecard, {
      judged: 4,
      first_pass: 3,
      avg_fixes: 0.25,
      decided: 5,
      sent_back: 1,
      tokens_per_done: 1200,
    });
    assert.deepEqual(head?.connectors, ['notion']);
    assert.deepEqual(head?.kinds, second?.kinds, '모두 같은 일꾼');
    for (const kind of ['general', 'browse', 'draft_post'])
      assert.ok(head?.kinds.includes(kind), kind);
    // 숫자가 없는 일꾼은 0
    assert.equal(second?.agent_id, finder.id);
    assert.deepEqual(second?.recent, { done: 0, failed: 0, revised: 0 });
    assert.equal(second?.scorecard, null);
  });

  test('일꾼은 맡기지 않는다: 일꾼의 목록은 비어 있다', () => {
    const { writer, all } = org();
    assert.deepEqual(new TeamRoster(all, []).members(writer), []);
  });

  test('에이전트 없는 일은 비어 있고, 이름은 지운 에이전트면 null', () => {
    const { finder, all } = org();
    const roster = new TeamRoster(all, []);
    assert.deepEqual(roster.members(null), []);
    assert.equal(roster.nameOf(finder.id), '조사');
    assert.equal(roster.nameOf('gone'), null);
    assert.equal(roster.nameOf(null), null);
  });

  test('최근 기간은 7일', () => {
    assert.equal(TeamRoster.since(NOW).toISOString(), '2026-11-10T00:00:00.000Z');
  });
});
