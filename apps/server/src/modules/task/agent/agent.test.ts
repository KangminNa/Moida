import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import type { AgentRow } from '../task.tables';
import { Agent } from './agent';
import { AgentUsage } from './agent-usage';

// 에이전트가 쉬는 규칙. DB 없이 돈다.

const NOW = new Date('2026-11-01T00:00:00Z');

function agentWith(fiveHourLimit: number | null, planStopPercent: number | null): Agent {
  return Agent.restore({
    id: 'agent-1',
    version: 1,
    space_id: 'space',
    name: '글쓰기',
    tool: 'claude',
    monthly_limit: null,
    five_hour_limit: fiveHourLimit,
    plan_stop_percent: planStopPercent,
    status: Agent.ACTIVE,
  } as AgentRow);
}

describe('Agent.holds', () => {
  test('한도를 정하지 않으면 쉬지 않는다', () => {
    assert.equal(agentWith(null, null).holds(1_000_000, 1000), false);
  });

  test('5시간 토큰이 한도에 닿으면 쉰다', () => {
    const agent = agentWith(100, null);
    assert.equal(agent.holds(99, null), false);
    assert.equal(agent.holds(100, null), true);
    assert.equal(agent.holds(101, null), true);
  });

  test('구독 사용률이 정한 값에 닿으면 쉰다', () => {
    const agent = agentWith(null, 80);
    assert.equal(agent.holds(0, 79), false);
    assert.equal(agent.holds(0, 80), true);
    assert.equal(agent.holds(0, 120), true);
  });

  test('구독 사용률이 확인 전이면 토큰 한도만 본다', () => {
    const agent = agentWith(100, 1);
    assert.equal(agent.holds(99, null), false);
    assert.equal(agent.holds(100, null), true);
  });

  test('둘 중 하나만 닿아도 쉰다', () => {
    const agent = agentWith(100, 80);
    assert.equal(agent.holds(100, 10), true);
    assert.equal(agent.holds(10, 90), true);
    assert.equal(agent.holds(10, 10), false);
  });

  test('쉬어도 상태는 그대로다: 저장할 것이 없다', () => {
    const agent = agentWith(100, 80);
    agent.holds(100, 90);
    assert.equal(agent.paused, false);
    assert.deepEqual(agent.unsaved, {});
    assert.deepEqual(agent.pullEvents(), []);
  });
});

describe('AgentUsage', () => {
  test('쉬거나 멈춘 에이전트에게는 새 일을 주지 않는다', () => {
    const agent = agentWith(100, null);
    assert.equal(new AgentUsage(agent, 99, 99, null).ready, true);
    assert.equal(new AgentUsage(agent, 100, 100, null).holding, true);
    assert.equal(new AgentUsage(agent, 100, 100, null).ready, false);
    agent.pause();
    assert.equal(new AgentUsage(agent, 0, 0, null).holding, false);
    assert.equal(new AgentUsage(agent, 0, 0, null).ready, false);
  });
});

describe('권한 (2026-11-21: 모두 같은 일꾼)', () => {
  test('무엇을 보내도 권한은 늘 전부다. 모르는 이름은 막는다', () => {
    const agent = agentWith(null, null);
    agent.edit({ scopes: ['browse', 'read_all', 'write', 'code'] });
    assert.deepEqual(agent.scopes, [...Agent.SCOPES]);
    assert.throws(() => agent.edit({ scopes: ['sandbox'] }), RuleViolation, '기기의 권한');
  });

  test('새 에이전트는 모든 권한과 사이트 클릭 · 로그인 승인 동작으로 시작한다', () => {
    const fresh = Agent.open('space', { name: '새', tool: 'claude' }, NOW);
    assert.deepEqual(fresh.scopes, [...Agent.SCOPES]);
    fresh.assertMayRequest('browser.site.login');
    fresh.assertMayRequest('browser.site.publish');
  });
});

describe('한도 칸', () => {
  test('범위를 벗어나면 거절한다', () => {
    const agent = agentWith(null, null);
    assert.throws(() => agent.edit({ five_hour_limit: 0 }), RuleViolation);
    assert.throws(() => agent.edit({ plan_stop_percent: 0 }), RuleViolation);
    assert.throws(() => agent.edit({ plan_stop_percent: 101 }), RuleViolation);
  });

  test('바뀐 열만 기억하고 null로 비울 수 있다', () => {
    const agent = agentWith(100, 80);
    agent.edit({ five_hour_limit: null, plan_stop_percent: 90 });
    assert.deepEqual(agent.unsaved, {
      five_hour_limit: null,
      plan_stop_percent: 90,
      settings_revision: 2,
    });
  });
});

describe('모델 · 생각 강도 (2차 7단계)', () => {
  test('빈 글은 CLI의 기본. 모델 이름은 설정 파일에 그대로 쓸 수 있는 글자만', () => {
    const agent = agentWith(null, null);
    agent.edit({ model: ' opus[1m] ', effort: 'high' });
    assert.deepEqual(agent.unsaved, { model: 'opus[1m]', effort: 'high', settings_revision: 2 });
    assert.throws(() => agent.edit({ model: 'opus"; rm' }), RuleViolation);
    assert.throws(() => agent.edit({ model: 'a'.repeat(81) }), RuleViolation);
    assert.throws(() => agent.edit({ effort: 'huge' }), RuleViolation);
    agent.edit({ model: '', effort: '' });
    assert.equal(agent.model, '');
    assert.equal(agent.effort, '');
  });

  test('강도는 도구가 받는 값만: 도구를 바꿀 때도 본다', () => {
    const agent = agentWith(null, null);
    agent.edit({ effort: 'max' });
    assert.throws(() => agent.edit({ tool: 'codex' }), RuleViolation, 'codex는 max를 받지 않는다');
    assert.throws(() => agent.edit({ tool: 'codex', effort: 'xhigh' }), RuleViolation);
    agent.edit({ tool: 'codex', effort: 'high' });
    assert.equal(agent.effort, 'high');
  });

  test('모델 · 강도도 설정 판에 남는다', () => {
    const agent = agentWith(null, null);
    agent.edit({ model: 'sonnet' });
    const settings = agent.addedRevision?.settings as Record<string, unknown>;
    assert.equal(settings.model, 'sonnet');
  });
});

describe('설정 판', () => {
  test('설정이 바뀌면 판을 하나 올리고 그 판의 설정 전부를 남긴다. 같은 값이면 그대로', () => {
    const agent = agentWith(100, 80);
    agent.edit({ five_hour_limit: 100 });
    assert.equal(agent.settingsRevision, 1, '같은 값');
    agent.edit({ role: '짧게 쓴다' });
    assert.equal(agent.settingsRevision, 2);
    const added = agent.addedRevision;
    assert.ok(added);
    assert.equal(added.revision, 2);
    const settings = added.settings as Record<string, unknown>;
    assert.equal(settings.role, '짧게 쓴다');
    assert.equal(settings.five_hour_limit, 100);
  });

  test('한 번의 저장 안에서 여러 번 바뀌어도 판은 하나 (마지막 모습)', () => {
    const agent = agentWith(null, null);
    agent.edit({ role: '하나' });
    agent.edit({ role: '둘' });
    assert.equal(agent.settingsRevision, 2);
    const added = agent.addedRevision;
    assert.ok(added);
    assert.equal((added.settings as Record<string, unknown>).role, '둘');
  });

  test('새 에이전트는 판 1. 멈춤 · 다시 시작은 설정 판이 아니다', () => {
    const fresh = Agent.open('space', { name: '새', tool: 'claude' }, new Date());
    assert.equal(fresh.addedRevision?.revision, 1);
    const agent = agentWith(null, null);
    agent.pause();
    agent.resume();
    assert.equal(agent.addedRevision, null);
  });
});

describe('맡기기 (Agent.manages)', () => {
  test('대표만 맡긴다: 지운 에이전트 · 다른 대표에게는 맡기지 않는다. 일꾼은 맡기지 않는다', () => {
    const lead = Agent.openLead('space', 'claude', NOW);
    const worker = Agent.open('space', { name: '일꾼', tool: 'codex' }, NOW);
    const other = Agent.open('space', { name: '다른 일꾼', tool: 'claude' }, NOW);
    assert.equal(lead.manages(worker), true);
    assert.equal(worker.manages(other), false);
    assert.equal(lead.manages(lead), false);
    other.delete(NOW);
    assert.equal(lead.manages(other), false);
  });
});
