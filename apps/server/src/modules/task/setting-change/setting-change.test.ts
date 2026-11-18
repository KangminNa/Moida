import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  Conflict,
  Forbidden,
  InvalidRequest,
  RuleViolation,
  SettingChangeInput,
  SettingKinds,
  type SettingShape,
} from '../../platform';
import { Agent } from '../agent/agent';
import { AgentEdit } from '../agent/agent-edit';
import { Approval } from '../approval/approval';
import { GoalEdit } from '../goal/goal-edit';
import { ScheduleEdit } from '../schedule/schedule-edit';
import { Task } from '../task/task';
import type { AgentRow } from '../task.tables';
import { GetSettingsInput, ProposeSettingInput } from './setting-change.input';
import { SettingChanges } from './setting-change.policy';

// 설정 바꾸기 제안 (2026-11-15 C · D): 바뀐 점 · 굵은 줄 · 펼친 줄 · 입력 모양 · 결재 칸 · 승인 뒤 값 비교 ·
// 대화 상대(대표, O-2)의 기본 동작. 등록부에는 가짜 읽기 · 적용을 단다. DB 없이 돈다.

const NOW = new Date('2026-11-15T00:00:00Z');
const SPACE = '00000000-0000-7000-8000-00000000000a';
const TARGET = '00000000-0000-7000-8000-000000000001';
const REQUEST = '00000000-0000-7000-8000-000000000002';

/** 알림 설정처럼 공간에 하나이고 목록형 칸이 있는 설정, 플러그인처럼 이름형 · 모든 줄이 굵은 설정 (시험용 모양) */
const NOTICE: SettingShape = {
  setting: 'notice',
  list: 'notices',
  ops: ['edit'],
  fields: ['quiet_start', 'routes'],
  target: 'one',
  versioned: true,
  grants: [],
  maps: ['routes'],
};
const PLUGIN: SettingShape = {
  setting: 'plugin',
  list: 'plugins',
  ops: ['edit'],
  fields: null,
  target: 'name',
  versioned: false,
  grants: 'all',
};

const kinds = new SettingKinds();
for (const shape of [AgentEdit.SETTING, ScheduleEdit.SETTING, GoalEdit.SETTING, NOTICE, PLUGIN])
  kinds.register({
    ...shape,
    read: async () => ({ toJSON: () => ({}) }),
    current: async () => null,
    rehearse: async () => {},
    apply: async () => {},
  });

const propose = (raw: Record<string, unknown>) =>
  ProposeSettingInput.from({ request_id: REQUEST, note: '왜', ...raw }, kinds);

function agent(reportsTo: string | null, actions: readonly string[] = [], lead = false): Agent {
  return Agent.restore({
    lead,
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
      AgentEdit.SETTING,
      { model: 'sonnet', effort: 'medium', name: '리서처' },
      { model: 'opus', name: '리서처' },
    );
    assert.deepEqual(lines, [{ field: 'model', before: 'sonnet', after: 'opus', grant: false }]);
  });

  test('권한 · 승인 동작 · 커넥터를 더하면 grant, 빼면 아니다', () => {
    const before = { scopes: ['read_public', 'draft'], external_tools: ['linear'] };
    const [more] = SettingChanges.diff(AgentEdit.SETTING, before, {
      scopes: ['read_public', 'draft', 'read_all'],
    });
    const [less] = SettingChanges.diff(AgentEdit.SETTING, before, { scopes: ['read_public'] });
    const [tools] = SettingChanges.diff(AgentEdit.SETTING, before, {
      external_tools: ['linear', 'notion'],
    });
    assert.equal(more?.grant, true);
    assert.equal(less?.grant, false);
    assert.equal(tools?.grant, true);
  });

  test('만들기는 지금 값이 없다 (권한이 있으면 grant)', () => {
    const lines = SettingChanges.diff(AgentEdit.SETTING, null, { name: '코더', scopes: ['code'] });
    assert.deepEqual(
      lines.map((l) => [l.field, l.before, l.grant]),
      [
        ['name', null, false],
        ['scopes', null, true],
      ],
    );
  });

  test('목록형 칸은 키마다 한 줄 (이름표와 함께), 같은 키는 빠진다', () => {
    const now = {
      quiet_start: null,
      routes: { 'task.approval.requested': 'push', other: 'center' },
    };
    const lines = SettingChanges.diff(
      NOTICE,
      now,
      { routes: { 'task.approval.requested': 'off', other: 'center' }, quiet_start: '23:00' },
      (f) => (f === 'routes.task.approval.requested' ? '승인 요청' : null),
    );
    assert.deepEqual(lines, [
      {
        field: 'routes.task.approval.requested',
        label: '승인 요청',
        before: 'push',
        after: 'off',
        grant: false,
      },
      { field: 'quiet_start', before: null, after: '23:00', grant: false },
    ]);
  });

  test('모든 줄이 굵은 설정(플러그인)은 바뀐 줄마다 grant, 비우는 줄은 아니다', () => {
    const lines = SettingChanges.diff(
      PLUGIN,
      { repo: 'me/a', branch: 'main' },
      {
        repo: 'me/b',
        branch: null,
      },
    );
    assert.deepEqual(
      lines.map((l) => [l.field, l.grant]),
      [
        ['repo', true],
        ['branch', false],
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
    assert.deepEqual(SettingChanges.restBody(agentEdit.fields), {
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
    const body = SettingChanges.restBodyOver(
      ScheduleEdit.SETTING.fields ?? [],
      scheduleEdit.fields,
      {
        title: '주간 정리',
        at_time: '09:30',
        daily_max: 1,
        id: TARGET,
      },
    );
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

describe('ProposeSettingInput (D)', () => {
  test('모르는 설정 · 동작은 400, 목표는 고치기에 대상 · 버전', () => {
    assert.throws(
      () => propose({ setting: 'secret', op: 'edit', fields: { a: 1 } }),
      InvalidRequest,
    );
    assert.throws(
      () => propose({ setting: 'goal', op: 'pause', target_id: TARGET, version: 1 }),
      InvalidRequest,
    );
    const goal = propose({
      setting: 'goal',
      op: 'edit',
      target_id: TARGET,
      version: 3,
      fields: { status: 'done' },
    });
    assert.deepEqual([goal.targetId, goal.version], [TARGET, 3]);
  });

  test('공간에 하나인 설정은 대상 없이 version(처음이면 0), 결재 대상은 공간', () => {
    const notice = propose({
      setting: 'notice',
      op: 'edit',
      version: 0,
      fields: { quiet_start: '23:00' },
    });
    assert.equal(notice.targetId, null);
    assert.deepEqual(
      [notice.approvalFields(SPACE).target_kind, notice.approvalFields(SPACE).target_id],
      ['space', SPACE],
    );
    assert.throws(
      () => propose({ setting: 'notice', op: 'edit', fields: { quiet_start: '1' } }),
      InvalidRequest,
    );
  });

  test('이름형 설정은 target_name, 칸은 그 모듈이 보고(아무 칸이나 받음), version이 없다', () => {
    assert.throws(
      () => propose({ setting: 'plugin', op: 'edit', fields: { repo: 'x' } }),
      InvalidRequest,
    );
    const plugin = propose({
      setting: 'plugin',
      op: 'edit',
      target_name: 'sync-github',
      fields: { repo: 'x' },
    });
    assert.deepEqual([plugin.targetName, plugin.version], ['sync-github', 0]);
    const change = plugin.change(plugin.fields, []);
    assert.deepEqual(change.payload(), {
      setting: 'plugin',
      op: 'edit',
      body: { repo: 'x' },
      changes: [],
      target_name: 'sync-github',
    });
  });

  test('get_settings는 등록한 kind만, 없으면 목록', () => {
    assert.equal(GetSettingsInput.from({}, kinds).kind, null);
    assert.equal(GetSettingsInput.from({ kind: 'goals' }, kinds).kind, 'goals');
    assert.throws(() => GetSettingsInput.from({ kind: 'secrets' }, kinds), InvalidRequest);
  });
});

describe('SettingChangeInput (승인 뒤 적용)', () => {
  const data = {
    approvalId: REQUEST,
    decidedBy: TARGET,
    action: Approval.SETTING_CHANGE,
    targetKind: 'agent',
    targetId: TARGET,
    targetVersion: 2,
    payload: { setting: 'agent', op: 'edit', body: { model: 'opus' }, changes: [] },
  };

  test('설정 바꾸기의 승인만 받고, 결재 칸에서 대상 · 판을 읽는다 (공간 대상이면 대상 없음)', () => {
    assert.equal(SettingChangeInput.carries(data), true);
    assert.equal(SettingChangeInput.carries({ ...data, action: 'blog.post.publish' }), false);
    const change = SettingChangeInput.approved(data);
    assert.deepEqual(
      [change.key, change.setting, change.op, change.targetId, change.version, change.decidedBy],
      [REQUEST, 'agent', 'edit', TARGET, 2, TARGET],
    );
    assert.deepEqual(change.body, { model: 'opus' });
    const space = SettingChangeInput.approved({ ...data, targetKind: 'space', targetId: SPACE });
    assert.equal(space.targetId, null);
  });

  test('version이 없는 설정: 지금 값이 제안 때 본 값과 다르면 Conflict (목록형 칸은 키를 본다)', () => {
    const change = SettingChangeInput.approved({
      ...data,
      payload: {
        setting: 'projects',
        op: 'edit',
        target_name: null,
        body: { collect: { blog: false } },
        changes: [{ field: 'collect.blog', before: true, after: false, grant: false }],
      },
    });
    assert.doesNotThrow(() => change.assertUnchanged({ collect: { blog: true } }));
    assert.throws(() => change.assertUnchanged({ collect: { blog: false } }), Conflict);
    assert.throws(() => change.assertUnchanged(null), Conflict);
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

  test('대표(O-2)는 승인 동작에 넣지 않아도 올리고, 팀장 · 팀원은 넣어 준 경우만', () => {
    const partner = agent(null, [], true);
    assert.equal(
      Approval.request(running(partner), partner, fields, NOW, null, payload).unsaved.status,
      'pending',
    );
    const head = agent(null);
    assert.throws(
      () => Approval.request(running(head), head, fields, NOW, null, payload),
      Forbidden,
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
    const partner = agent(null, [], true);
    const approval = Approval.request(running(partner), partner, fields, NOW, null, payload);
    const event = approval.pullEvents().at(-1);
    assert.deepEqual(event?.data.payload, payload);
    assert.deepEqual(approval.proposedView().toJSON().changes, []);
  });
});
