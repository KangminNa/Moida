import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';
import { Database, OutboxWorker } from '../../platform';

// 설정 바꾸기 제안 (2026-11-15 C · D): get_settings → propose_setting(미리 해 보기 + 결재 task.setting.change) → 승인 → 적용.
// 러너는 MCP로, 관리자는 REST로 들어오고 승인 뒤 적용은 outbox와 일꾼을 실제로 거친다. AI는 띄우지 않는다.
// 제안하는 쪽은 대표(O-2)이거나 승인 동작에 설정 바꾸기를 넣어 준 에이전트. 대표의 continue는 적용 뒤 같은 대화의 회차를 연다.

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
  assert.ok(result, res.text);
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

/** 공간의 대표 (O-2). before에서 첫 대화를 열어 만들어 둔다 */
const lead = async (): Promise<Json> => ok(await api.get('/api/agents/lead', owner)).lead;

/** 대표와 일꾼 하나 (팀은 2026-11-21에 없앴다). 대표의 일을 러너가 빌린 토큰 */
async function partner() {
  const boss = await lead();
  const member = await agent({ model: 'sonnet' });
  const job = await take(boss.id);
  return { lead: boss, member, job, token: String(job.run_token) };
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
  // 기기 연결(OAuth)은 사이트 주소가 있어야 한다: 이 파일만 돌려도 되게 이 서버의 주소로 정한다
  const space = ok(await api.get('/api/space'));
  ok(
    await api.request('PUT', '/api/space', owner, {
      name: space.name || '돌무더기',
      siteUrl: api.baseUrl,
      version: space.version,
    }),
  );
  runner = await api.connectDevice(owner, 'setting-runner');
  const { devices } = ok(await api.get('/api/devices', owner));
  const device = (devices as Json[]).find((d) => d.name === 'setting-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  ok(
    await api.request('POST', '/api/chats', owner, {
      requestId: randomUUID(),
      message: '대표를 만드는 첫 대화',
    }),
    201,
  );
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

after(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
  await db.sql`UPDATE task.agents SET status = 'paused' WHERE NOT lead`; // 대표(O-2)는 뒤 파일의 대화가 쓴다
  await drain();
  await api.close();
});

describe('설정 바꾸기: 읽기와 제안', () => {
  test('대표는 팀을 읽고, 바꿀 값을 제안하면 결재가 바뀔 칸과 함께 올라온다. 승인 전에는 바뀌지 않는다', async () => {
    const { lead: boss, member, job, token } = await partner();
    const team = await call(token, 'get_settings', { kind: 'team' });
    const seen = (team.agents as Json[]).find((a) => a.id === member.id) as Json;
    assert.equal(seen.model, 'sonnet');
    assert.equal('reports_to' in seen, false, '보고 라인은 없다');
    assert.ok(!(team.agents as Json[]).some((a) => a.id === boss.id), '팀 목록에 대표는 없다');
    const self = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'edit',
      target_id: boss.id,
      version: boss.version,
      fields: { model: 'opus' },
      note: '나를 바꾸기',
    });
    assert.deepEqual(
      [self.ok, self.body.code],
      [false, 'rule_violation'],
      '대표는 관리자가 바꾼다',
    );
    const proposed = await call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'edit',
      target_id: member.id,
      version: seen.version,
      fields: { model: 'opus', approval_actions: [...seen.approval_actions, 'blog.post.publish'] },
      note: '글 공개를 올리게 하려고',
    });
    assert.equal(proposed.status, 'pending');
    assert.deepEqual(
      (proposed.changes as Json[]).map((c) => [c.field, c.before, c.after, c.grant]),
      [
        ['model', 'sonnet', 'opus', false],
        [
          'approval_actions',
          seen.approval_actions,
          [...seen.approval_actions, 'blog.post.publish'],
          true,
        ],
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
    assert.deepEqual(changed.approvalActions, [...seen.approval_actions, 'blog.post.publish']);
    // 승인한 동작을 실행하면 기다리던 작업이 끝난다 (다른 결재와 같다, ApprovalResultHandler)
    assert.equal(ok(await api.get(`/api/tasks/${job.task.id}`, owner)).status, 'done');
  });

  test('규칙에 어긋나면 제안하는 자리에서 막힌다 (서버만 올리는 승인 동작)', async () => {
    const { member, token } = await partner();
    const res = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'edit',
      target_id: member.id,
      version: (await current(member.id)).version,
      fields: { approval_actions: ['task.agent.raise_limit'] },
      note: '한도 올리기',
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
    // 승인으로 앞 작업은 끝났다: 다음 제안은 새 대화 상대의 일에서
    const { token: next } = await partner();
    const { goals } = await call(next, 'get_settings', { kind: 'goals' });
    const goal = (goals as Json[]).find((g) => g.title === title) as Json;
    assert.equal(goal.status, 'active');

    const moved = await tool(next, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'goal',
      op: 'edit',
      target_id: goal.id,
      version: goal.version,
      fields: { parent_id: randomUUID() },
      note: '옮겨요',
    });
    assert.equal(moved.body.code, 'rule_violation');
    const done = await call(next, 'propose_setting', {
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

describe('설정 바꾸기: 커넥터 켜기 · 끄기 (C4)', () => {
  test('get_settings connectors는 토큰 · 경로 없이 출처만, 승인해야 꺼진다. 주소 · 토큰 칸은 받지 않는다', async () => {
    const name = `note${randomUUID().slice(0, 6)}`;
    ok(
      await api.request('POST', '/api/external-tools', owner, {
        requestId: randomUUID(),
        name,
        title: '노트',
        url: 'https://mcp.example.com/v1/secret-path?key=abc',
        header_name: 'Authorization',
      }),
      201,
    );
    const { token } = await partner();
    const { connectors } = await call(token, 'get_settings', { kind: 'connectors' });
    const mine = (connectors as Json[]).find((c) => c.name === name) as Json;
    assert.deepEqual(
      [mine.origin, mine.enabled, mine.title],
      ['https://mcp.example.com', true, '노트'],
    );
    assert.equal(
      JSON.stringify(mine).includes('secret-path'),
      false,
      '주소의 경로 · 질의는 싣지 않는다',
    );

    const url = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'connector',
      op: 'edit',
      target_id: mine.id,
      version: mine.version,
      fields: { url: 'https://evil.example.com' },
      note: '주소 바꾸기',
    });
    assert.equal(url.ok, false, '주소는 화면에서만');

    const off = await call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'connector',
      op: 'edit',
      target_id: mine.id,
      version: mine.version,
      fields: { enabled: false },
      note: '이번 주는 쓰지 않아요',
    });
    assert.deepEqual(
      (off.changes as Json[]).map((c) => [c.field, c.before, c.after]),
      [['enabled', true, false]],
    );
    const before = (ok(await api.get('/api/external-tools', owner)).tools as Json[]).find(
      (t) => t.name === name,
    ) as Json;
    assert.equal(before.status, 'active', '승인 전에는 그대로');
    await decide(off.approval_id);
    const after = (ok(await api.get('/api/external-tools', owner)).tools as Json[]).find(
      (t) => t.name === name,
    ) as Json;
    assert.equal(after.status, 'off');
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
    const { token: other } = await partner();
    const url = await tool(other, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'site',
      op: 'edit',
      version: site.version,
      fields: { site_url: 'https://evil.example' },
      note: '왜',
    });
    assert.equal(url.body.code, 'invalid_request', '사이트 주소는 대화로 바꾸지 않는다');
    await decide(proposed.approval_id);
    assert.equal(ok(await api.get('/api/space', owner)).description, description);
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
    const { token: next } = await partner();
    const off = await propose(next, {
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
      fields: {
        app_id: await api.blogApp(owner),
        name,
        kind: 'posts',
        slug: `m-${randomUUID().slice(0, 6)}`,
        policy: '짧게',
      },
    });
    await decide(made.approval_id);
    const { token: next } = await partner();
    const { menus } = await call(next, 'get_settings', { kind: 'menus' });
    const menu = (menus as Json[]).find((m) => m.name === name) as Json;
    assert.deepEqual([menu.kind, menu.policy], ['posts', '짧게']);
    const kind = await tool(next, 'propose_setting', {
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

describe('설정 바꾸기: 스토어의 앱 (스토어 1단계)', () => {
  const propose = (token: string, fields: Json) =>
    call(token, 'propose_setting', { request_id: randomUUID(), note: '왜', ...fields });

  test('만들기는 승인 뒤에 비공개로 생기고 시작 메뉴도 함께. 공개 여부는 제안하지 못한다', async () => {
    const { token } = await partner();
    const slug = `ai-${randomUUID().slice(0, 6)}`;
    const made = await propose(token, {
      setting: 'app',
      op: 'create',
      fields: { name: '요리 블로그', slug, kind: 'blog', menus: ['레시피', '맛집'] },
    });
    assert.equal((await api.get(`/api/apps/by-slug/${slug}`, owner)).status, 404, '승인 전');
    await decide(made.approval_id);
    const { token: next } = await partner();
    const { apps } = await call(next, 'get_settings', { kind: 'apps' });
    const app = (apps as Json[]).find((a) => a.slug === slug) as Json;
    assert.deepEqual([app.name, app.kind, app.visibility], ['요리 블로그', 'blog', 'private']);
    const menus = ok(await api.get(`/api/menus?app=${slug}`, owner)).menus as Json[];
    assert.deepEqual(
      menus.map((m) => m.name),
      ['레시피', '맛집'],
    );
    const open = await tool(next, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'app',
      op: 'edit',
      target_id: app.id,
      version: app.version,
      fields: { visibility: 'public' },
      note: '공개해 주세요',
    });
    assert.equal(open.body.code, 'invalid_request', '공개는 관리자가 앱 관리에서');
    const kind = await tool(next, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'app',
      op: 'edit',
      target_id: app.id,
      version: app.version,
      fields: { kind: 'magazine' },
      note: '왜',
    });
    assert.equal(kind.body.code, 'rule_violation', '종류는 만들 때만');
  });

  test('편집 방침은 제안 → 승인. 운영 팀 칸(agent_id · new_team)은 없고 첫 화면 고정은 제안하지 못한다', async () => {
    const { token } = await partner();
    const slug = `policy-${randomUUID().slice(0, 6)}`;
    const made = ok(
      await api.request('POST', '/api/apps', owner, {
        requestId: randomUUID(),
        kind: 'blog',
        name: '방침 앱',
        slug,
      }),
      201,
    );
    const edit = (fields: Json) =>
      tool(token, 'propose_setting', {
        request_id: randomUUID(),
        setting: 'app',
        op: 'edit',
        target_id: made.id,
        version: made.version,
        fields,
        note: '왜',
      });
    for (const fields of [{ agent_id: randomUUID() }, { new_team: true }, { home: true }])
      assert.equal((await edit(fields)).body.code, 'invalid_request', JSON.stringify(fields));
    const proposed = await edit({ policy: '사진 한 장 이상' });
    assert.equal(proposed.ok, true, JSON.stringify(proposed.body));
    await decide(proposed.body.approval_id);
    const { token: next } = await partner();
    const { apps } = await call(next, 'get_settings', { kind: 'apps' });
    const app = (apps as Json[]).find((a) => a.slug === slug) as Json;
    assert.deepEqual([app.policy, app.home, 'agent_id' in app], ['사진 한 장 이상', false, false]);
  });

  test('페이지 앱은 승인 한 번에 페이지 없이 생긴다. 에이전트는 늘지 않는다 (2026-11-21)', async () => {
    const { token } = await partner();
    const slug = `trip-${randomUUID().slice(0, 6)}`;
    const agentsNow = async () => ok(await api.get('/api/agents', owner)).agents as Json[];
    const before = (await agentsNow()).length;
    const made = await propose(token, {
      setting: 'app',
      op: 'create',
      fields: { name: '여행 계획', slug, kind: 'page' },
    });
    await decide(made.approval_id);
    const app = (ok(await api.get('/api/apps', owner)).apps as Json[]).find(
      (a) => a.slug === slug,
    ) as Json;
    assert.deepEqual([app.kind, app.visibility], ['page', 'private']);
    assert.equal((await agentsNow()).length, before);
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
    } finally {
      await api.request('POST', '/api/plugins/comments-giscus/disable', owner);
    }
  });
});

describe('설정 바꾸기: 막는 것', () => {
  test('일꾼은 승인 동작에 넣어 주지 않으면 읽지도 제안하지도 못한다 (기본으로는 대표만, O-2)', async () => {
    const plain = await agent();
    const res = await tool(String((await take(plain.id)).run_token), 'get_settings', {
      kind: 'team',
    });
    assert.deepEqual([res.ok, res.body.code], [false, 'forbidden']);
    // 모든 일꾼이 브라우저를 써도(2026-11-21) 넣어 준 일꾼은 읽는다
    const allowed = await agent({ approvalActions: ['task.setting.change'] });
    const job = await take(allowed.id);
    assert.equal((await tool(String(job.run_token), 'get_settings', { kind: 'team' })).ok, true);
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

describe('승인 뒤 이어서 (O-2): 대표의 propose_setting continue', () => {
  /** 대화를 열고 대표의 회차를 러너가 빌린다 */
  async function chatTurn(message: string): Promise<{ chat: Json; job: Json }> {
    const chat = ok(
      await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message }),
      201,
    );
    for (let i = 0; i < 50; i++) {
      const { jobs } = (await call(runner, 'next_jobs', { limit: 5 })) as { jobs: Json[] };
      const job = jobs.find((j) => j.task.payload?.chat?.chatId === chat.id);
      if (job) return { chat, job };
      if (jobs.length === 0) break;
    }
    throw new Error('대화의 회차를 빌리지 못했어요');
  }
  const room = async (chatId: unknown) => ok(await api.get(`/api/chats/${chatId}`, owner));
  const proposeModel = (token: string, member: Json, more: Json = {}) =>
    call(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'agent',
      op: 'edit',
      target_id: member.id,
      version: member.version,
      fields: { model: 'opus' },
      note: '조사에 더 강한 모델이 필요해요',
      ...more,
    });
  /** 결과 카드에서 그 결재를 골라 승인한다 */
  async function approveInCard(chatId: unknown, approvalId: unknown): Promise<void> {
    await drain();
    const { card } = await room(chatId);
    assert.ok(card, '설정 바꾸기가 결과 카드에 실린다');
    ok(
      await api.request('POST', `/api/approvals/${card.id}/decide`, owner, {
        version: card.version,
        decision: 'approve',
        picked: [approvalId],
      }),
    );
    await drain();
  }

  test('적용되면 같은 대화에 회차가 하나 열린다 (승인 뒤 이어서, 결재마다 한 번)', async () => {
    const member = await agent({ model: 'sonnet' });
    const { chat, job } = await chatTurn('조사 팀을 강하게 해서 시장 조사해 줘');
    const proposed = await proposeModel(String(job.run_token), member, { continue: true });
    const [row] = await db.sql`
      SELECT payload->>'continue' AS go FROM task.approvals WHERE id = ${proposed.approval_id}`;
    assert.equal(row?.go, 'true');
    await approveInCard(chat.id, proposed.approval_id);
    assert.equal((await current(member.id)).model, 'opus');
    const after = await room(chat.id);
    assert.deepEqual(
      after.turns.map((t: Json) => [t.turn, t.status, t.fix, t.fixBy]),
      [
        [1, 'done', false, null],
        [2, 'queued', true, 'setting'],
      ],
    );
    assert.match(after.turns[1].message, /승인한 설정이 적용됐어요/);
    assert.match(after.turns[1].message, /agent edit/);
    await drain();
    assert.equal((await room(chat.id)).chat.turns, 2, '두 번 열지 않는다');
  });

  test('받을 것이 아직 없어도 이어서 하자는 설정 바꾸기가 카드에 있으면 "승인하면 이어서"로 보인다 (스토어 2-6)', async () => {
    const member = await agent({ model: 'sonnet' });
    const { chat, job } = await chatTurn('조사 팀을 강하게 해서 보고서 파일로 줘');
    await call(String(job.run_token), 'set_deliver', { deliver: 'file' });
    await proposeModel(String(job.run_token), member, { continue: true });
    await drain();
    const { card } = await room(chat.id);
    assert.deepEqual([card.deliver, card.passed, card.continues], ['file', false, true]);
  });

  test('적용이 실패하면 열지 않는다. 대표가 아닌 에이전트의 continue는 읽지 않는다', async () => {
    const member = await agent({ model: 'sonnet' });
    const { chat, job } = await chatTurn('모델을 바꿔서 다시 해 줘');
    const proposed = await proposeModel(String(job.run_token), member, { continue: true });
    // 승인 전에 관리자가 바꾸면 적용은 낡은 버전이라 실패한다
    ok(
      await api.request('PATCH', `/api/agents/${member.id}`, owner, {
        version: member.version,
        role: '바뀐 역할',
      }),
    );
    await approveInCard(chat.id, proposed.approval_id);
    const after = await room(chat.id);
    assert.deepEqual(
      [after.chat.turns, after.turns[0].status],
      [1, 'failed'],
      '실패한 회차 뒤에는 이어서 하지 않는다',
    );

    const helper = await agent({ approvalActions: ['task.setting.change'] });
    const other = await take(helper.id);
    const theirs = await proposeModel(String(other.run_token), await current(member.id), {
      continue: true,
    });
    const [row] = await db.sql`
      SELECT payload ? 'continue' AS has FROM task.approvals WHERE id = ${theirs.approval_id}`;
    assert.equal(row?.has, false);
  });
});

describe('설정 바꾸기: 앱 데이터 (앱 플랫폼, 스토어 12.4)', () => {
  test('표에 줄 넣기는 승인 뒤에 들어간다. 없는 표 · 틀린 값은 제안에서 막힌다', async () => {
    const mark = randomUUID().slice(0, 6);
    const site = await CommunitySite.openPage(api, owner, `lessons-${mark}`, {
      tables: {
        lessons: { columns: { title: 'text', level: 'int' }, read: 'anyone', write: 'admin' },
      },
    });
    const { token, job } = await partner();
    const { app_data: tables } = await call(token, 'get_settings', { kind: 'app_data' });
    const mine = (tables as Json[]).find((t) => t.app_id === site.appId) as Json;
    assert.deepEqual([mine.table, mine.columns], ['lessons', { title: 'text', level: 'int' }]);

    const propose = (fields: Json) =>
      tool(token, 'propose_setting', {
        request_id: randomUUID(),
        note: '오늘의 레슨',
        setting: 'app_data',
        op: 'create',
        fields: { app_id: site.appId, ...fields },
      });
    assert.equal((await propose({ table: 'nothing', rows: [{ title: 'x' }] })).ok, false);
    assert.equal((await propose({ table: 'lessons', rows: [{ level: '높음' }] })).ok, false);

    const made = await propose({
      table: 'lessons',
      rows: [
        { title: '인사하기', level: 1 },
        { title: '길 묻기', level: 2 },
      ],
    });
    assert.equal(made.ok, true, JSON.stringify(made.body));
    const before = ok(await site.at('/api/community/data/lessons'));
    assert.equal(before.rows.length, 0, '승인 전에는 들어가지 않는다');
    await decide(made.body.approval_id);
    const after = ok(await site.at('/api/community/data/lessons?order=level.asc'));
    assert.deepEqual(
      (after.rows as Json[]).map((r) => r.title),
      ['인사하기', '길 묻기'],
    );
    // 넣은 결과(community.setting.changed)를 받아 기다리던 작업이 끝난다 (ApprovalResultHandler)
    assert.equal(ok(await api.get(`/api/tasks/${job.task.id}`, owner)).status, 'done');
  });
});

describe('설정 바꾸기: 약관 (스토어 3-4)', () => {
  test('일꾼이 약관의 새 버전을 제안하면 승인 뒤에 공개되고 기록은 approved, 그사이 관리자가 고쳤으면 실패한다', async () => {
    const mark = randomUUID().slice(0, 6);
    const site = await CommunitySite.open(api, owner, `terms-${mark}`);
    let { token } = await partner();
    const { terms } = await call(token, 'get_settings', { kind: 'terms' });
    assert.equal(
      (terms as Json[]).filter((t) => t.app_id === site.appId).length,
      2,
      '이용약관 · 개인정보처리방침의 지금 버전',
    );
    const propose = (body: string) =>
      tool(token, 'propose_setting', {
        request_id: randomUUID(),
        note: '연락처를 채움',
        setting: 'terms',
        op: 'update',
        target_id: site.appId,
        fields: { app_id: site.appId, kind: 'terms', body },
      });
    assert.equal((await propose('')).ok, false, '빈 약관은 미리 해 보기에서 막힌다');
    const made = await propose('# 이용약관\n\n문의: 운영자');
    assert.equal(made.ok, true, JSON.stringify(made.body));
    assert.equal(ok(await site.at('/api/community/terms/terms')).version, 1, '승인 전에는 그대로');
    await decide(made.body.approval_id);
    const now = ok(await site.at('/api/community/terms/terms'));
    assert.deepEqual([now.version, now.body], [2, '# 이용약관\n\n문의: 운영자']);
    const admin = ok(await api.get(`/api/community/admin/${site.appId}/terms`, owner));
    const first = (admin.items as Json[])[0];
    assert.equal((first?.current as Json | undefined)?.approved, true);

    // 승인하면 기다리던 작업이 끝나 그 작업 토큰도 끝난다: 다음 제안은 새 일에서
    token = (await partner()).token;
    const late = await propose('# 이용약관\n\n늦은 제안');
    assert.equal(late.ok, true);
    ok(
      await api.request('POST', `/api/community/admin/${site.appId}/terms/terms`, owner, {
        version: 2,
        body: '# 관리자가 고침',
      }),
      201,
    );
    await decide(late.body.approval_id);
    assert.equal(ok(await site.at('/api/community/terms/terms')).body, '# 관리자가 고침');
  });
});
