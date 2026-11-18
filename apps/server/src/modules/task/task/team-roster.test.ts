import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Agent } from '../agent/agent';
import { TeamRoster } from './team-roster';

// 팀원 정보 (D1): 팀장은 바로 아래 팀원의 일 수 · 커넥터와 그 아래 팀의 요약만 본다. DB 없이 돈다.

const NOW = new Date('2026-11-17T00:00:00Z');

function org() {
  const make = (name: string, scopes: string[], tool = 'claude') =>
    Agent.open('space', { name, tool, scopes }, NOW);
  const lead = make('팀장', ['read_public']);
  const mid = make('조사 팀장', ['read_public']);
  const writer = make('글쓰기', ['read_public', 'write'], 'codex');
  const one = make('조사 1', ['read_public', 'browse']);
  const two = make('조사 2', ['read_public']);
  const all = [lead, mid, writer, one, two];
  mid.reportTo(lead.id, all);
  writer.reportTo(lead.id, all);
  one.reportTo(mid.id, all);
  two.reportTo(mid.id, all);
  return { lead, mid, writer, one, two, all };
}

describe('팀원 정보 (TeamRoster)', () => {
  test('바로 아래 팀원마다 일 수 · 도구 · 커넥터, 그 아래 팀은 사람 수와 일의 종류별 수만', () => {
    const { lead, mid, writer, all } = org();
    const roster = new TeamRoster(all, [
      { agent_id: mid.id, open: 2, done: 5, failed: 1, revised: 1, connectors: ['notion'] },
    ]);
    const members = roster.members(lead).map((m) => m.toJSON());
    assert.deepEqual(
      members.map((m) => m.name),
      ['조사 팀장', '글쓰기'],
    );
    const [head, second] = members;
    assert.equal(head?.open, 2);
    assert.deepEqual(head?.recent, { done: 5, failed: 1, revised: 1 });
    assert.deepEqual(head?.connectors, ['notion']);
    assert.deepEqual(head?.team, {
      members: 2,
      kinds: { general: 2, draft_post: 2, browse: 1 },
      connectors: {},
    });
    // 숫자가 없는 팀원은 0, 아래 팀이 없으면 null
    assert.equal(second?.agent_id, writer.id);
    assert.equal(second?.tool, 'codex');
    assert.deepEqual(second?.recent, { done: 0, failed: 0, revised: 0 });
    assert.equal(second?.team, null);
    // 한 층만: 손자 팀원의 이름은 어디에도 없다
    assert.doesNotMatch(JSON.stringify(members), /조사 1|조사 2/);
  });

  test('대표(O-2)는 맨 위 에이전트 전부를 보고, 아래 팀 요약은 손자 팀까지 사람 · 일 · 커넥터 수만 (이름 없음)', () => {
    const { lead, mid, one, all } = org();
    const other = Agent.open('space', { name: '운영 팀장', tool: 'claude', scopes: [] }, NOW);
    const boss = Agent.openLead('space', 'claude', NOW);
    const everyone = [...all, other, boss];
    const roster = new TeamRoster(everyone, [
      { agent_id: mid.id, open: 0, done: 0, failed: 0, revised: 0, connectors: ['notion'] },
      {
        agent_id: one.id,
        open: 0,
        done: 0,
        failed: 0,
        revised: 0,
        connectors: ['notion', 'linear'],
      },
    ]);
    const members = roster.members(boss).map((m) => m.toJSON());
    assert.deepEqual(
      members.map((m) => m.name),
      ['팀장', '운영 팀장'],
    );
    assert.deepEqual(members[0]?.team, {
      members: 4,
      kinds: { general: 4, draft_post: 4, browse: 1 },
      connectors: { notion: 2, linear: 1 },
    });
    assert.equal(members[1]?.team, null);
    assert.doesNotMatch(JSON.stringify(members), /조사 팀장|조사 1|조사 2|글쓰기/);
    // 대표는 누구의 팀원도 아니다
    assert.equal(lead.manages(boss), false);
  });

  test('에이전트 없는 일은 팀이 없고, 이름은 지운 에이전트면 null', () => {
    const { mid, all } = org();
    const roster = new TeamRoster(all, []);
    assert.deepEqual(roster.members(null), []);
    assert.equal(roster.nameOf(mid.id), '조사 팀장');
    assert.equal(roster.nameOf('gone'), null);
    assert.equal(roster.nameOf(null), null);
  });

  test('최근 기간은 7일', () => {
    assert.equal(TeamRoster.since(NOW).toISOString(), '2026-11-10T00:00:00.000Z');
  });
});
