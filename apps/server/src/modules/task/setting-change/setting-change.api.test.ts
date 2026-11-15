import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 설정 바꾸기 제안 (2026-11-15 C · D): get_settings → propose_setting(미리 해 보기 + 결재 task.setting.change) → 승인 → 적용.
// 러너는 MCP로, 관리자는 REST로 들어오고 승인 뒤 적용은 outbox와 일꾼을 실제로 거친다. AI는 띄우지 않는다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
/** run 권한 기기 (러너) */
let runner: string;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.status === 204 ? {} : res.json();
}

async function tool(token: string, name: string, args: Json = {}) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json;
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') as Json }
    : { ok: true, body: (result.structuredContent ?? {}) as Json };
}

async function call(token: string, name: string, args: Json = {}): Promise<Json> {
  const { ok: done, body } = await tool(token, name, args);
  assert.equal(done, true, JSON.stringify(body));
  return body;
}

const agent = async (more: Json = {}) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `설정 ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public'],
      ...more,
    }),
    201,
  );
const current = async (id: unknown) =>
  (ok(await api.get('/api/agents', owner)).agents as Json[]).find((a) => a.id === id) as Json;

/** 이 에이전트에게 일을 맡기고 러너가 빌린다 */
async function take(agentId: unknown): Promise<Json> {
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId,
      instruction: '도구로 조사',
    }),
    201,
  );
  for (let i = 0; i < 50; i++) {
    const { jobs } = (await call(runner, 'next_jobs')) as { jobs: Json[] };
    const mine = jobs.find((j) => j.task.id === task.id);
    if (mine) return mine;
    if (jobs.length === 0) break;
  }
  throw new Error('맡긴 일을 빌리지 못했어요');
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

/** 대화 상대(관리자 바로 아래) 하나와 그 팀원 하나. 대화 상대의 일을 러너가 빌린 토큰 */
async function partner() {
  const lead = await agent();
  const member = await agent({ reportsTo: lead.id, model: 'sonnet' });
  const job = await take(lead.id);
  return { lead, member, job, token: String(job.run_token) };
}

async function decide(approvalId: unknown, decision = 'approve') {
  const approval = ok(await api.get(`/api/approvals/${approvalId}`, owner));
  ok(
    await api.request('POST', `/api/approvals/${approvalId}/decide`, owner, {
      version: approval.version,
      decision,
    }),
  );
  await drain();
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  runner = await api.connectDevice(owner, 'setting-runner');
  const { devices } = ok(await api.get('/api/devices', owner));
  const device = (devices as Json[]).find((d) => d.name === 'setting-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
});

after(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
  await db.sql`UPDATE task.agents SET status = 'paused'`;
  await drain();
  await api.close();
});

describe('설정 바꾸기: 읽기와 제안', () => {
  test('대화 상대는 팀을 읽고, 바꿀 값을 제안하면 결재가 바뀔 칸과 함께 올라온다. 승인 전에는 바뀌지 않는다', async () => {
    const { member, job, token } = await partner();
    const team = await call(token, 'get_settings', { kind: 'team' });
    const seen = (team.agents as Json[]).find((a) => a.id === member.id) as Json;
    assert.equal(seen.model, 'sonnet');
    assert.equal(seen.reports_to !== null, true);
    const proposed = await call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'edit',
      target_id: member.id,
      version: seen.version,
      fields: { model: 'opus', scopes: ['read_public', 'draft'] },
      note: '글을 쓰게 하려고',
    });
    assert.equal(proposed.status, 'pending');
    assert.deepEqual(
      (proposed.changes as Json[]).map((c) => [c.field, c.before, c.after, c.grant]),
      [
        ['model', 'sonnet', 'opus', false],
        ['scopes', ['read_public'], ['read_public', 'draft'], true],
      ],
    );
    const approval = ok(await api.get(`/api/approvals/${proposed.approval_id}`, owner));
    assert.equal(approval.action, 'task.setting.change');
    assert.equal((approval.changes as Json[]).length, 2);
    assert.equal((await current(member.id)).model, 'sonnet', '승인 전에는 그대로');
    assert.equal(ok(await api.get(`/api/tasks/${job.task.id}`, owner)).status, 'waiting');

    await decide(proposed.approval_id);
    const changed = await current(member.id);
    assert.equal(changed.model, 'opus');
    assert.deepEqual(changed.scopes, ['read_public', 'draft']);
    assert.equal(ok(await api.get(`/api/tasks/${job.task.id}`, owner)).status, 'running');
  });

  test('규칙에 어긋나면 제안하는 자리에서 막힌다 (브라우저 + 전체 읽기)', async () => {
    const { member, token } = await partner();
    const res = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'edit',
      target_id: member.id,
      version: (await current(member.id)).version,
      fields: { scopes: ['browse', 'read_all'] },
      note: '둘 다',
    });
    assert.equal(res.ok, false);
    assert.equal(res.body.code, 'rule_violation');
  });

  test('낡은 버전은 409, 바뀌는 칸이 없으면 422, 모르는 칸은 400', async () => {
    const { member, token } = await partner();
    const base = { setting: 'agent', op: 'edit', target_id: member.id, note: '왜' };
    const stale = await tool(token, 'propose_setting', {
      ...base,
      request_id: randomUUID(),
      version: (await current(member.id)).version + 5,
      fields: { model: 'opus' },
    });
    assert.equal(stale.body.code, 'conflict');
    const same = await tool(token, 'propose_setting', {
      ...base,
      request_id: randomUUID(),
      version: (await current(member.id)).version,
      fields: { model: 'sonnet' },
    });
    assert.equal(same.body.code, 'rule_violation');
    const strange = await tool(token, 'propose_setting', {
      ...base,
      request_id: randomUUID(),
      version: (await current(member.id)).version,
      fields: { password: 'x' },
    });
    assert.equal(strange.body.code, 'invalid_request');
  });

  test('승인한 뒤 대상이 바뀌었으면 적용하지 않고 실패로 끝난다', async () => {
    const { member, job, token } = await partner();
    const proposed = await call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'edit',
      target_id: member.id,
      version: (await current(member.id)).version,
      fields: { model: 'opus' },
      note: '바꿔요',
    });
    ok(
      await api.request('PATCH', `/api/agents/${member.id}`, owner, {
        version: (await current(member.id)).version,
        name: '그사이 바뀜',
      }),
    );
    await decide(proposed.approval_id);
    assert.equal((await current(member.id)).model, 'sonnet');
    const task = ok(await api.get(`/api/tasks/${job.task.id}`, owner));
    assert.notEqual(task.status, 'waiting');
  });

  test('멈추기 제안과 스케줄 만들기 제안도 승인 뒤에 적용된다', async () => {
    const { member, token } = await partner();
    const paused = await call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'pause',
      target_id: member.id,
      version: (await current(member.id)).version,
      note: '잠시 쉬게',
    });
    await decide(paused.approval_id);
    assert.equal((await current(member.id)).status, 'paused');

    const { token: other } = await partner();
    const title = `매주 정리 ${randomUUID().slice(0, 6)}`;
    const made = await call(other, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'schedule',
      op: 'create',
      fields: {
        title,
        enabled: false,
        mode: 'daily',
        at_time: '09:30',
        time_zone: 'Asia/Seoul',
        instruction: '주간 정리',
        daily_max: 1,
      },
      note: '매주 정리하려고',
    });
    await decide(made.approval_id);
    const { schedules } = ok(await api.get('/api/schedules', owner));
    assert.ok((schedules as Json[]).some((s) => s.title === title));
  });
});

describe('설정 바꾸기: 목록과 목표 (D)', () => {
  test('kind 없이 읽으면 바꿀 수 있는 설정의 목록 (모듈이 등록한 것)', async () => {
    const { token } = await partner();
    const { kinds } = await call(token, 'get_settings');
    const lists = (kinds as Json[]).map((k) => k.kind);
    for (const kind of [
      'team',
      'schedules',
      'goals',
      'menus',
      'site',
      'notices',
      'tidy',
      'projects',
      'plugins',
    ])
      assert.ok(lists.includes(kind), kind);
    const goal = (kinds as Json[]).find((k) => k.kind === 'goals') as Json;
    assert.deepEqual([goal.setting, goal.target], ['goal', 'id']);
  });

  test('목표 만들기 · 끝내기 제안은 승인 뒤에 적용된다. 상위 목표는 만들 때만', async () => {
    const { token } = await partner();
    const title = `분기 목표 ${randomUUID().slice(0, 6)}`;
    const made = await call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'goal',
      op: 'create',
      fields: { title, description: '이번 분기' },
      note: '목표를 세워요',
    });
    assert.deepEqual(
      (made.changes as Json[]).map((c) => c.field),
      ['title', 'description'],
    );
    assert.equal(
      (ok(await api.get('/api/goals', owner)).goals as Json[]).some((g) => g.title === title),
      false,
      '승인 전에는 없다',
    );
    await decide(made.approval_id);
    const { goals } = await call(token, 'get_settings', { kind: 'goals' });
    const goal = (goals as Json[]).find((g) => g.title === title) as Json;
    assert.equal(goal.status, 'active');

    const moved = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'goal',
      op: 'edit',
      target_id: goal.id,
      version: goal.version,
      fields: { parent_id: randomUUID() },
      note: '옮겨요',
    });
    assert.equal(moved.body.code, 'rule_violation');
    const done = await call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'goal',
      op: 'edit',
      target_id: goal.id,
      version: goal.version,
      fields: { status: 'done' },
      note: '끝났어요',
    });
    assert.deepEqual(
      (done.changes as Json[]).map((c) => [c.field, c.before, c.after]),
      [['status', 'active', 'done']],
    );
    await decide(done.approval_id);
    const after = (ok(await api.get('/api/goals', owner)).goals as Json[]).find(
      (g) => g.id === goal.id,
    ) as Json;
    assert.equal(after.status, 'done');
  });
});

describe('설정 바꾸기: 다른 모듈의 설정 (D)', () => {
  const propose = (token: string, fields: Json) =>
    call(token, 'propose_setting', { request_id: randomUUID(), note: '바꿔요', ...fields });

  test('알림: 경로는 종류마다 한 줄(이름표와 함께), 승인 뒤 조용한 시간 · 경로가 바뀐다', async () => {
    const { token } = await partner();
    const { notices } = await call(token, 'get_settings', { kind: 'notices' });
    const proposed = await propose(token, {
      setting: 'notice',
      op: 'edit',
      version: notices.version,
      fields: {
        quiet_start: '23:00',
        quiet_end: '07:00',
        routes: { 'task.approval.requested': 'center' },
      },
    });
    const route = (proposed.changes as Json[]).find(
      (c) => c.field === 'routes.task.approval.requested',
    ) as Json;
    assert.deepEqual([route.label, route.before, route.after], ['승인 요청', 'push', 'center']);
    await decide(proposed.approval_id);
    const after = ok(await api.get('/api/notice-settings', owner));
    assert.deepEqual([after.quietStart, after.quietEnd], ['23:00', '07:00']);
    const kind = (after.kinds as Json[]).find((k) => k.kind === 'task.approval.requested') as Json;
    assert.equal(kind.route, 'center');
  });

  test('알림: 모르는 종류 · 맞지 않는 시각은 제안하는 자리에서 막힌다', async () => {
    const { token } = await partner();
    const { notices } = await call(token, 'get_settings', { kind: 'notices' });
    const strange = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'notice',
      op: 'edit',
      version: notices.version,
      fields: { routes: { 'no.such.kind': 'off' } },
      note: '왜',
    });
    assert.equal(strange.body.code, 'rule_violation');
    const half = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'notice',
      op: 'edit',
      version: notices.version,
      fields: { quiet_start: notices.quiet_start === null ? '22:00' : null },
      note: '왜',
    });
    assert.equal(half.body.code, 'rule_violation', '조용한 시간은 시작과 끝을 함께');
  });

  test('사이트: 이름 · 소개만, 승인 뒤 바뀐다', async () => {
    const { token } = await partner();
    const { site } = await call(token, 'get_settings', { kind: 'site' });
    const description = `소개 ${randomUUID().slice(0, 6)}`;
    const proposed = await propose(token, {
      setting: 'site',
      op: 'edit',
      version: site.version,
      fields: { description },
    });
    await decide(proposed.approval_id);
    assert.equal(ok(await api.get('/api/space', owner)).description, description);
    const url = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'site',
      op: 'edit',
      version: site.version + 1,
      fields: { site_url: 'https://evil.example' },
      note: '왜',
    });
    assert.equal(url.body.code, 'invalid_request', '사이트 주소는 대화로 바꾸지 않는다');
  });

  test('세션 정리 · 프로젝트별 모으기: 승인 뒤 바뀌고, 그사이 관리자가 바꾼 프로젝트는 실패로 끝난다', async () => {
    const { token } = await partner();
    const { tidy } = await call(token, 'get_settings', { kind: 'tidy' });
    const turned = await propose(token, {
      setting: 'tidy',
      op: 'edit',
      version: tidy.version,
      fields: { auto_tidy: !tidy.auto_tidy, cadence: 'daily' },
    });
    await decide(turned.approval_id);
    assert.equal(ok(await api.get('/api/tidy/settings', owner)).autoTidy, !tidy.auto_tidy);

    const project = `proj-${randomUUID().slice(0, 6)}`;
    const off = await propose(token, {
      setting: 'projects',
      op: 'edit',
      fields: { collect: { [project]: false } },
    });
    assert.deepEqual(
      (off.changes as Json[]).map((c) => [c.field, c.before, c.after]),
      [[`collect.${project}`, true, false]],
    );
    await decide(off.approval_id);
    const rules = ok(await api.get('/api/project-rules', owner)).projects as Json[];
    assert.equal(rules.find((r) => r.project === project)?.collect, false);

    const { job, token: other } = await partner();
    const later = `proj-${randomUUID().slice(0, 6)}`;
    const stale = await propose(other, {
      setting: 'projects',
      op: 'edit',
      fields: { collect: { [later]: false } },
    });
    ok(await api.request('PUT', '/api/project-rules', owner, { project: later, collect: false }));
    await decide(stale.approval_id);
    const task = ok(await api.get(`/api/tasks/${job.task.id}`, owner));
    assert.notEqual(task.status, 'waiting');
    const approval = ok(await api.get(`/api/approvals/${stale.approval_id}`, owner));
    assert.notEqual(approval.status, 'pending');
  });

  test('블로그 메뉴: 만들기는 승인 뒤에 생기고, 종류는 만들 때만', async () => {
    const { token } = await partner();
    const name = `메뉴 ${randomUUID().slice(0, 6)}`;
    const made = await propose(token, {
      setting: 'menu',
      op: 'create',
      fields: { name, kind: 'posts', slug: `m-${randomUUID().slice(0, 6)}`, policy: '짧게' },
    });
    await decide(made.approval_id);
    const { menus } = await call(token, 'get_settings', { kind: 'menus' });
    const menu = (menus as Json[]).find((m) => m.name === name) as Json;
    assert.deepEqual([menu.kind, menu.policy], ['posts', '짧게']);
    const kind = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'menu',
      op: 'edit',
      target_id: menu.id,
      version: menu.version,
      fields: { kind: 'issues' },
      note: '왜',
    });
    assert.equal(kind.body.code, 'rule_violation');
  });
});

describe('설정 바꾸기: 플러그인 설정 (D)', () => {
  const giscus = { repo: 'me/blog', repoId: 'R_1', category: 'Comments', categoryId: 'DIC_1' };

  test('켜진 플러그인의 비밀이 아닌 칸만. 줄은 모두 굵고 이름표는 목록 파일의 label, 비밀 칸은 값을 보이지 않는다', async () => {
    ok(
      await api.request('PUT', '/api/plugins/comments-giscus/settings', owner, { values: giscus }),
    );
    ok(await api.request('POST', '/api/plugins/comments-giscus/enable', owner));
    try {
      const { token } = await partner();
      const { plugins } = await call(token, 'get_settings', { kind: 'plugins' });
      const listed = (plugins as Json[]).find((p) => p.name === 'comments-giscus') as Json;
      assert.equal(listed.enabled, true);
      const sync = (plugins as Json[]).find((p) => p.name === 'sync-github') as Json;
      const secret = (sync.settings as Json[]).find((s) => s.key === 'token') as Json;
      assert.deepEqual(['value' in secret, typeof secret.set], [false, 'boolean']);

      const proposed = await call(token, 'propose_setting', {
        request_id: randomUUID(),
        setting: 'plugin',
        op: 'edit',
        target_name: 'comments-giscus',
        fields: { repo: 'me/other' },
        note: '저장소를 옮겼어요',
      });
      const [line] = proposed.changes as Json[];
      assert.deepEqual(
        [line?.field, line?.before, line?.after, line?.grant],
        ['repo', 'me/blog', 'me/other', true],
      );
      assert.equal(typeof line?.label, 'string');
      await decide(proposed.approval_id);
      assert.equal(
        ok(await api.get('/api/plugins/comments-giscus/settings')).settings.repo,
        'me/other',
      );

      const off = await tool(token, 'propose_setting', {
        request_id: randomUUID(),
        setting: 'plugin',
        op: 'edit',
        target_name: 'sync-github',
        fields: { token: 'x' },
        note: '왜',
      });
      assert.equal(
        off.body.code,
        'rule_violation',
        '꺼진 플러그인 · 비밀 칸은 대화로 바꾸지 않는다',
      );
    } finally {
      await api.request('POST', '/api/plugins/comments-giscus/disable', owner);
    }
  });
});

describe('설정 바꾸기: 막는 것', () => {
  test('팀원은 승인 동작에 넣어 주지 않으면 읽지도 제안하지도 못한다', async () => {
    const lead = await agent();
    const member = await agent({ reportsTo: lead.id });
    const job = await take(member.id);
    const res = await tool(String(job.run_token), 'get_settings', { kind: 'team' });
    assert.equal(res.ok, false);
    assert.equal(res.body.code, 'forbidden');
  });

  test('브라우저 에이전트는 대화 상대여도 읽지 못한다', async () => {
    const browser = await agent({ scopes: ['browse'] });
    const job = await take(browser.id);
    const res = await tool(String(job.run_token), 'get_settings', { kind: 'schedules' });
    assert.equal(res.body.code, 'forbidden');
  });

  test('request_approval로 설정 바꾸기를 바로 올리지 못한다 (바뀔 값을 서버가 미리 해 봐야)', async () => {
    const { member, token } = await partner();
    const res = await tool(token, 'request_approval', {
      request_id: randomUUID(),
      action: 'task.setting.change',
      target_kind: 'agent',
      target_id: member.id,
      target_version: 1,
    });
    assert.equal(res.body.code, 'rule_violation');
  });

  test('방문자는 MCP 설정 도구를 부르지 못한다 (작업 토큰으로만)', async () => {
    const visitor = await api.mcp(null, 'tools/call', {
      name: 'get_settings',
      arguments: { kind: 'team' },
    });
    assert.equal(visitor.status, 401);
  });
});
