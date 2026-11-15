import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Forbidden, InvalidRequest, RuleViolation } from '../../platform';
import { Agent } from '../agent/agent';
import { Approval } from '../approval/approval';
import { Task } from '../task/task';
import type { AgentRow } from '../task.tables';
import { ApprovedSettingInput, ProposeSettingInput } from './setting-change.input';
import { SettingChanges } from './setting-change.policy';

// 설정 바꾸기 제안 (2026-11-15 C): 바뀐 점 · 권한 줄 · 입력 모양 · 결재 칸 · 대화 상대의 기본 동작. DB 없이 돈다.

const NOW = new Date('2026-11-15T00:00:00Z');
const SPACE = '00000000-0000-7000-8000-00000000000a';
const TARGET = '00000000-0000-7000-8000-000000000001';
const REQUEST = '00000000-0000-7000-8000-000000000002';

const propose = (raw: Record<string, unknown>) =>
  ProposeSettingInput.from({ request_id: REQUEST, note: '왜', ...raw });

function agent(reportsTo: string | null, actions: readonly string[] = []): Agent {
  return Agent.restore({
    id: 'agent-1',
    space_id: 'space',
    version: 1,
    name: '대표',
    tool: 'claude',
    scopes: [],
    approval_actions: actions,
    external_tools: [],
    reports_to: reportsTo,
    status: Agent.ACTIVE,
  } as unknown as AgentRow);
}

function running(who: Agent): Task {
  const task = Task.open(
    'space',
    'request',
    { agent_id: who.id, kind: 'general', title: '대화' },
    NOW,
  );
  task.lease('runner', who.id, NOW);
  return task;
}

describe('SettingChanges.diff', () => {
  test('바뀐 칸만, 지금 값과 함께', () => {
    const lines = SettingChanges.diff(
      { model: 'sonnet', effort: 'medium', name: '리서처' },
      { model: 'opus', name: '리서처' },
    );
    assert.deepEqual(lines, [{ field: 'model', before: 'sonnet', after: 'opus', grant: false }]);
  });

  test('권한 · 승인 동작 · 커넥터를 더하면 grant, 빼면 아니다', () => {
    const before = { scopes: ['read_public', 'draft'], external_tools: ['linear'] };
    const [more] = SettingChanges.diff(before, { scopes: ['read_public', 'draft', 'read_all'] });
    const [less] = SettingChanges.diff(before, { scopes: ['read_public'] });
    const [tools] = SettingChanges.diff(before, { external_tools: ['linear', 'notion'] });
    assert.equal(more?.grant, true);
    assert.equal(less?.grant, false);
    assert.equal(tools?.grant, true);
  });

  test('만들기는 지금 값이 없다 (권한이 있으면 grant)', () => {
    const lines = SettingChanges.diff(null, { name: '코더', scopes: ['code'] });
    assert.deepEqual(
      lines.map((l) => [l.field, l.before, l.grant]),
      [
        ['name', null, false],
        ['scopes', null, true],
      ],
    );
  });

  test('멈추기 · 재개는 상태 한 줄. 이미 그 상태면 바뀔 것이 없다', () => {
    assert.deepEqual(SettingChanges.switched({ status: 'active' }, 'pause'), [
      { field: 'status', before: 'active', after: 'paused', grant: false },
    ]);
    assert.deepEqual(SettingChanges.switched({ status: 'paused' }, 'pause'), []);
  });

  test('브라우저 · 커넥터 에이전트는 설정을 읽거나 제안하지 못한다', () => {
    assert.throws(() => SettingChanges.assertInside(['browse'], []), Forbidden);
    assert.throws(() => SettingChanges.assertInside([], ['notion']), Forbidden);
    assert.doesNotThrow(() => SettingChanges.assertInside(['read_all', 'draft'], []));
  });
});

describe('ProposeSettingInput', () => {
  test('고치기는 대상 · 버전 · 칸이 있어야 하고, 모르는 칸은 400', () => {
    assert.throws(
      () => propose({ setting: 'agent', op: 'edit', fields: { model: 'opus' } }),
      InvalidRequest,
    );
    assert.throws(
      () =>
        propose({
          setting: 'agent',
          op: 'edit',
          target_id: TARGET,
          version: 2,
          fields: { secret: 'x' },
        }),
      InvalidRequest,
    );
    const req = propose({
      setting: 'agent',
      op: 'edit',
      target_id: TARGET,
      version: 2,
      fields: { model: 'opus' },
    });
    assert.equal(req.targetId, TARGET);
    assert.equal(req.version, 2);
  });

  test('스케줄은 멈추기를 받지 않고, 멈추기는 칸을 받지 않는다', () => {
    assert.throws(
      () => propose({ setting: 'schedule', op: 'pause', target_id: TARGET, version: 1 }),
      InvalidRequest,
    );
    assert.throws(
      () =>
        propose({
          setting: 'agent',
          op: 'pause',
          target_id: TARGET,
          version: 1,
          fields: { name: 'x' },
        }),
      InvalidRequest,
    );
    assert.equal(
      propose({ setting: 'agent', op: 'pause', target_id: TARGET, version: 1 }).switching,
      true,
    );
  });

  test('본문은 관리자 REST 이름으로. 스케줄 고치기는 지금 값 위에 얹는다', () => {
    const agentEdit = propose({
      setting: 'agent',
      op: 'edit',
      target_id: TARGET,
      version: 1,
      fields: { reports_to: null, approval_actions: ['blog.post.publish'] },
    });
    assert.deepEqual(agentEdit.bodyOver({ name: '리서처', model: 'sonnet' }), {
      reportsTo: null,
      approvalActions: ['blog.post.publish'],
    });
    const scheduleEdit = propose({
      setting: 'schedule',
      op: 'edit',
      target_id: TARGET,
      version: 3,
      fields: { at_time: '10:00' },
    });
    const body = scheduleEdit.bodyOver({
      title: '주간 정리',
      at_time: '09:30',
      daily_max: 1,
      id: TARGET,
    });
    assert.equal(body.atTime, '10:00');
    assert.equal(body.title, '주간 정리');
    assert.equal(body.dailyMax, 1);
    assert.equal('id' in body, false);
  });

  test('결재 칸: 동작 task.setting.change, 만들기면 대상은 공간 · 판 0', () => {
    const create = propose({
      setting: 'agent',
      op: 'create',
      fields: { name: '코더', tool: 'claude' },
    });
    assert.deepEqual(create.approvalFields(SPACE), {
      action: Approval.SETTING_CHANGE,
      target_kind: 'space',
      target_id: SPACE,
      target_version: 0,
      note: '왜',
    });
    const edit = propose({
      setting: 'schedule',
      op: 'edit',
      target_id: TARGET,
      version: 4,
      fields: { enabled: false },
    });
    assert.equal(edit.approvalFields(SPACE).target_kind, 'schedule');
    assert.equal(edit.approvalFields(SPACE).target_version, 4);
  });
});

describe('ApprovedSettingInput', () => {
  const data = {
    approvalId: REQUEST,
    decidedBy: TARGET,
    action: Approval.SETTING_CHANGE,
    targetId: TARGET,
    targetVersion: 2,
    payload: { setting: 'agent', op: 'edit', body: { model: 'opus' }, changes: [] },
  };

  test('그 설정의 바꾸기만 받는다', () => {
    assert.equal(ApprovedSettingInput.carries(data, SettingChanges.AGENT), true);
    assert.equal(ApprovedSettingInput.carries(data, SettingChanges.SCHEDULE), false);
    assert.equal(
      ApprovedSettingInput.carries({ ...data, action: 'blog.post.publish' }, 'agent'),
      false,
    );
    const req = ApprovedSettingInput.from(data);
    assert.equal(req.op, 'edit');
    assert.deepEqual(req.body, { model: 'opus' });
  });
});

describe('대화 상대의 기본 동작', () => {
  const fields = {
    action: Approval.SETTING_CHANGE,
    target_kind: 'agent',
    target_id: TARGET,
    target_version: 1,
    note: null,
  };
  const payload = { setting: 'agent', op: 'edit', body: {}, changes: [] };

  test('관리자 바로 아래는 승인 동작에 넣지 않아도 올리고, 팀원은 넣어 준 경우만', () => {
    const partner = agent(null);
    assert.equal(
      Approval.request(running(partner), partner, fields, NOW, null, payload).unsaved.status,
      'pending',
    );
    const member = agent(TARGET);
    assert.throws(
      () => Approval.request(running(member), member, fields, NOW, null, payload),
      Forbidden,
    );
    const allowed = agent(TARGET, [Approval.SETTING_CHANGE]);
    assert.doesNotThrow(() =>
      Approval.request(running(allowed), allowed, fields, NOW, null, payload),
    );
  });

  test('바뀔 값 없이 request_approval로 올린 설정 바꾸기는 막는다', () => {
    const partner = agent(null);
    assert.throws(
      () => Approval.request(running(partner), partner, fields, NOW, null),
      RuleViolation,
    );
  });

  test('승인 이벤트에 바뀔 값이 실린다 (다른 모듈 · 패키지가 읽는다)', () => {
    const partner = agent(null);
    const approval = Approval.request(running(partner), partner, fields, NOW, null, payload);
    const event = approval.pullEvents().at(-1);
    assert.deepEqual(event?.data.payload, payload);
    assert.deepEqual(approval.proposedView().toJSON().changes, []);
  });
});
