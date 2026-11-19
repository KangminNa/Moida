import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 앱별 운영 (스토어 2단계, docs/스토어.md 10장): 앱의 운영 팀장은 맨 위의, 비공개를 읽지 않는 에이전트만.
// 운영 팀은 팀장과 그 아래 팀 전체이고, 메뉴에 운영 팀이 있으면 메뉴가 정한다. 관리자 · 기기는 늘 놓는다.
// 방문자 첫 화면 고정은 관리자만, 공개 앱만, 공간마다 하나.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** run 권한을 준 기기 (러너) */
let runner: string;
/** write 권한 기기의 Bearer 머리글 (관리 일은 막힌다) */
let device: Readonly<Record<string, string>>;
const mark = randomUUID().slice(0, 6);

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(token: string, name: string, args: Json = {}) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') as Json }
    : { ok: true, body: result.structuredContent ?? {} };
}

/** 이 파일이 만든 에이전트 (끝나면 멈춘다) */
const agents: Json[] = [];

const agent = async (name: string, scopes: readonly string[], more: Json = {}) => {
  const made = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `${name} ${mark}`,
      tool: 'claude',
      scopes,
      ...more,
    }),
    201,
  );
  agents.push(made);
  return made;
};

/** 이 에이전트에게 일을 맡기고 러너가 빌린다. 그 일의 작업 토큰 */
async function tokenOf(agentId: unknown): Promise<string> {
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId,
      instruction: '앱에 글을 써 주세요',
    }),
    201,
  );
  for (let i = 0; i < 50; i++) {
    const { body } = await tool(runner, 'next_jobs');
    const jobs = (body.jobs ?? []) as { task: Json; run_token: string }[];
    const mine = jobs.find((j) => j.task.id === task.id);
    if (mine) return mine.run_token;
    if (jobs.length === 0) break;
  }
  throw new Error('맡긴 일을 빌리지 못했어요');
}

const newApp = async (slug: string, more: Json = {}) =>
  ok(
    await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind: 'blog',
      name: `앱 ${slug}`,
      slug: `${slug}-${mark}`,
      ...more,
    }),
    201,
  );

const patchApp = async (app: Json, changes: Json) =>
  ok(
    await api.request('PATCH', `/api/apps/${app.id}`, owner, { version: app.version, ...changes }),
  );

const menusOf = async (app: Json) =>
  ok(await api.get(`/api/menus?app=${app.slug}`, owner)).menus as Json[];

const draft = (token: string, more: Json) =>
  tool(token, 'blog_save_draft', {
    request_id: randomUUID(),
    title: '운영 팀 초안',
    body_md: '본문',
    ...more,
  });

const placeOf = async (postId: unknown) => {
  const [row] = await db.sql<{ app_id: string | null; menu_id: string | null }[]>`
    SELECT app_id, menu_id FROM blog.posts WHERE id = ${String(postId)}`;
  return row;
};

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  device = { authorization: `Bearer ${await api.writeDevice(owner, `team-writer-${mark}`)}` };
  runner = await api.connectDevice(owner, `team-runner-${mark}`);
  const { devices } = ok(await api.get('/api/devices', owner));
  const it = (devices as Json[]).find((d) => d.name === `team-runner-${mark}`) as Json;
  ok(
    await api.request('PATCH', `/api/devices/${it.id}`, owner, {
      scopes: [...(it.scopes as string[]), 'run'],
      version: it.version,
    }),
  );
});

after(async () => {
  // 담당 없는 일은 가장 먼저 만든 움직이는 에이전트가 맡는다. 다음 테스트 파일의 일을 가져가지 않게 멈춘다 (post-tool과 같다)
  for (const made of agents)
    ok(await api.request('POST', `/api/agents/${made.id}/pause`, owner, { version: made.version }));
  await api.request('PUT', '/api/apps/home', owner, { appId: null });
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  await api.close();
});

describe('앱의 운영 팀장 · 편집 방침 (관리자)', () => {
  test('맨 위의, 비공개를 읽지 않는 에이전트만 팀장이 된다 (422 · 404). 방침은 4000자까지', async () => {
    const head = await agent('팀장', ['write']);
    const member = await agent('팀원', ['write'], { reportsTo: head.id });
    const reader = await agent('비공개', ['read_all']);
    const app = await newApp('lead', { agentId: head.id, policy: '짧게' });
    assert.deepEqual([app.agentId, app.policy, app.home], [head.id, '짧게', false]);

    const deep = await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind: 'blog',
      name: '아래 팀원',
      slug: `deep-${mark}`,
      agentId: member.id,
    });
    assert.equal(deep.status, 422, deep.text);
    assert.equal(
      (
        await api.request('PATCH', `/api/apps/${app.id}`, owner, {
          version: app.version,
          agentId: reader.id,
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await api.request('PATCH', `/api/apps/${app.id}`, owner, {
          version: app.version,
          agentId: randomUUID(),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await api.request('PATCH', `/api/apps/${app.id}`, owner, {
          version: app.version,
          policy: 'x'.repeat(4001),
        })
      ).status,
      400,
      '입력 모양에서 막힌다 (방침 한도)',
    );

    const cleared = await patchApp(app, { agentId: null, policy: '' });
    assert.deepEqual([cleared.agentId, cleared.policy], [null, '']);
  });

  test('방문자 · write 기기는 운영 팀을 보지도 바꾸지도 못한다', async () => {
    const head = await agent('공개 팀장', ['write']);
    const app = await newApp('seen', { agentId: head.id, policy: '방침' });
    await patchApp(app, { visibility: 'public' });
    const shown = (ok(await api.get('/api/apps')).apps as Json[]).find((a) => a.slug === app.slug);
    assert.ok(shown);
    assert.deepEqual(['agentId' in shown, 'policy' in shown, shown.home], [false, false, false]);
    const res = await api.request(
      'PATCH',
      `/api/apps/${app.id}`,
      TestUser.visitor,
      { version: 2, agentId: null },
      device,
    );
    assert.ok([401, 403].includes(res.status), res.text);
  });
});

describe('운영 팀만 앱 · 메뉴에 글을 놓는다 (blog_save_draft · blog_menus)', () => {
  let app: Json;
  let other: Json;
  let menu: Json;
  let head: Json;
  let writer: string;
  let outsider: string;
  let outsiderId: unknown;

  before(async () => {
    head = await agent('편집장', ['write']);
    const member = await agent('작가', ['write'], { reportsTo: head.id });
    const stranger = await agent('남의 팀', ['write']);
    outsiderId = stranger.id;
    app = await newApp('team', { agentId: head.id, policy: '앱 방침' });
    other = await newApp('free');
    menu = (await menusOf(app))[0] as Json;
    writer = await tokenOf(member.id);
    outsider = await tokenOf(stranger.id);
  });

  test('blog_menus: 앱 · 메뉴마다 방침 · 운영 팀장 · can_write. app_id로 한 앱만', async () => {
    const mine = (await tool(writer, 'blog_menus', { app_id: app.id })).body;
    const apps = mine.apps as Json[];
    assert.deepEqual(
      apps.map((a) => [a.id, a.policy, a.agent_id, a.can_write]),
      [[app.id, '앱 방침', head.id, true]],
    );
    const menus = mine.menus as Json[];
    assert.deepEqual(
      menus.map((m) => [m.id, m.app_id, m.can_write]),
      [[menu.id, app.id, true]],
    );
    const theirs = (await tool(outsider, 'blog_menus')).body;
    const seen = (theirs.apps as Json[]).find((a) => a.id === app.id) as Json;
    const free = (theirs.apps as Json[]).find((a) => a.id === other.id) as Json;
    assert.deepEqual([seen.can_write, free.can_write], [false, true]);
    const missing = await tool(writer, 'blog_menus', { app_id: randomUUID() });
    assert.equal(missing.body.code, 'not_found');
  });

  test('팀장 아래 작가는 앱 · 메뉴에 놓고, 팀 밖은 403', async () => {
    const intoApp = await draft(writer, { app_id: app.id });
    assert.equal(intoApp.ok, true, JSON.stringify(intoApp.body));
    assert.deepEqual(await placeOf(intoApp.body.post_id), { app_id: app.id, menu_id: null });
    const intoMenu = await draft(writer, { menu_id: menu.id });
    assert.equal(intoMenu.ok, true, JSON.stringify(intoMenu.body));
    assert.deepEqual(await placeOf(intoMenu.body.post_id), { app_id: app.id, menu_id: menu.id });

    for (const where of [{ app_id: app.id }, { menu_id: menu.id }]) {
      const refused = await draft(outsider, where);
      assert.equal(refused.body.code, 'forbidden', JSON.stringify(where));
    }
    const free = await draft(outsider, { app_id: other.id });
    assert.equal(free.ok, true, '운영 팀이 없는 앱은 지금처럼 누구나 (비공개를 읽지 않으면)');
  });

  test('메뉴에 운영 팀이 있으면 메뉴가 정한다', async () => {
    const now = (await menusOf(app)).find((m) => m.id === menu.id) as Json;
    ok(
      await api.request('PATCH', `/api/menus/${menu.id}`, owner, {
        version: now.version,
        agentId: outsiderId,
      }),
    );
    try {
      assert.equal((await draft(outsider, { menu_id: menu.id })).ok, true);
      assert.equal((await draft(writer, { menu_id: menu.id })).body.code, 'forbidden');
      assert.equal((await draft(writer, { app_id: app.id })).ok, true, '앱에는 그대로');
      const listed = (await tool(writer, 'blog_menus', { app_id: app.id })).body;
      assert.equal(((listed.menus as Json[])[0] as Json).can_write, false);
    } finally {
      const back = (await menusOf(app)).find((m) => m.id === menu.id) as Json;
      ok(
        await api.request('PATCH', `/api/menus/${menu.id}`, owner, {
          version: back.version,
          agentId: null,
        }),
      );
    }
  });

  test('app_id와 menu_id가 다른 앱이면 422. 같은 앱의 app_id만 보내면 메뉴를 두고 그대로', async () => {
    const mixed = await draft(writer, { app_id: other.id, menu_id: menu.id });
    assert.equal(mixed.body.code, 'rule_violation');
    const placed = await draft(writer, { menu_id: menu.id });
    const again = await tool(writer, 'blog_save_draft', {
      request_id: randomUUID(),
      post_id: placed.body.post_id,
      base_version: placed.body.version,
      title: '운영 팀 초안',
      body_md: '고친 본문',
      app_id: app.id,
    });
    assert.equal(again.ok, true, JSON.stringify(again.body));
    assert.deepEqual(await placeOf(placed.body.post_id), { app_id: app.id, menu_id: menu.id });
  });

  test('기기는 운영 팀과 상관없이 놓는다 (사람이 연결한 도구)', async () => {
    const token = String(device.authorization).replace('Bearer ', '');
    const placed = await draft(token, { menu_id: menu.id });
    assert.equal(placed.ok, true, JSON.stringify(placed.body));
  });
});

describe('방문자 첫 화면 고정 (PUT /api/apps/home)', () => {
  /** 고정 (204, 본문 없음) */
  const pin = async (appId: unknown) => {
    const res = await api.request('PUT', '/api/apps/home', owner, { appId });
    assert.equal(res.status, 204, res.text);
  };

  test('공개 앱만, 공간마다 하나. 비공개로 바꾸면 풀리고 null은 모두 풀기', async () => {
    const first = await newApp('home-a');
    const second = await newApp('home-b');
    const closed = await api.request('PUT', '/api/apps/home', owner, { appId: first.id });
    assert.equal(closed.status, 422, '비공개 앱은 고정하지 못한다');
    const a = await patchApp(first, { visibility: 'public' });
    const b = await patchApp(second, { visibility: 'public' });
    await pin(a.id);
    const homes = async () =>
      (ok(await api.get('/api/apps')).apps as Json[]).filter((x) => x.home).map((x) => x.slug);
    assert.deepEqual(await homes(), [a.slug]);
    await pin(b.id);
    assert.deepEqual(await homes(), [b.slug], '앞의 고정은 풀린다');
    await pin(b.id);
    assert.deepEqual(await homes(), [b.slug], '같은 값은 그대로');

    const now = (ok(await api.get('/api/apps', owner)).apps as Json[]).find(
      (x) => x.id === b.id,
    ) as Json;
    const hidden = await patchApp(now, { visibility: 'private' });
    assert.equal(hidden.home, false);
    assert.deepEqual(await homes(), []);

    await pin(a.id);
    await pin(null);
    assert.deepEqual(await homes(), []);
    const missing = await api.request('PUT', '/api/apps/home', owner, { appId: randomUUID() });
    assert.equal(missing.status, 404);
  });

  test('방문자 · write 기기는 고정하지 못한다', async () => {
    const visitor = await api.request('PUT', '/api/apps/home', TestUser.visitor, { appId: null });
    assert.ok([401, 403].includes(visitor.status), visitor.text);
    const writer = await api.request(
      'PUT',
      '/api/apps/home',
      TestUser.visitor,
      { appId: null },
      device,
    );
    assert.ok([401, 403].includes(writer.status), writer.text);
  });
});
