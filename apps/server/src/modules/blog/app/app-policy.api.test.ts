import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 앱별 운영 (스토어 2단계, docs/스토어.md 10장): 앱 · 메뉴의 편집 방침. 운영 팀은 2026-11-21에 없앴다:
// 모든 에이전트가 같은 일꾼이라 어느 앱 · 메뉴에나 초안을 놓는다 (공개는 여전히 승인 뒤).
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

const agent = async (name: string) => {
  const made = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `${name} ${mark}`,
      tool: 'claude',
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
    title: '앱 초안',
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

describe('앱의 편집 방침 (관리자)', () => {
  test('만들 때 · 고칠 때 정하고 4000자까지. 운영 팀 칸은 없다', async () => {
    const app = await newApp('policy', { policy: '짧게' });
    assert.deepEqual([app.policy, app.home, 'agentId' in app], ['짧게', false, false]);
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
    const cleared = await patchApp(app, { policy: '' });
    assert.equal(cleared.policy, '');
  });

  test('방문자 · write 기기는 방침을 보지도 바꾸지도 못한다', async () => {
    const app = await newApp('seen', { policy: '방침' });
    await patchApp(app, { visibility: 'public' });
    const shown = (ok(await api.get('/api/apps')).apps as Json[]).find((a) => a.slug === app.slug);
    assert.ok(shown);
    assert.deepEqual(['policy' in shown, shown.home], [false, false]);
    const res = await api.request(
      'PATCH',
      `/api/apps/${app.id}`,
      TestUser.visitor,
      { version: 2, policy: '' },
      device,
    );
    assert.ok([401, 403].includes(res.status), res.text);
  });
});

describe('모든 에이전트가 앱 · 메뉴에 글을 놓는다 (blog_save_draft · blog_menus, 2026-11-21)', () => {
  let app: Json;
  let other: Json;
  let menu: Json;
  let writer: string;
  let another: string;

  before(async () => {
    const first = await agent('작가');
    const second = await agent('다른 일꾼');
    app = await newApp('team', { policy: '앱 방침' });
    other = await newApp('free');
    menu = (await menusOf(app))[0] as Json;
    writer = await tokenOf(first.id);
    another = await tokenOf(second.id);
  });

  test('blog_menus: 앱 · 메뉴마다 방침과 can_write(늘 true). app_id로 한 앱만', async () => {
    const mine = (await tool(writer, 'blog_menus', { app_id: app.id })).body;
    assert.deepEqual(
      (mine.apps as Json[]).map((a) => [a.id, a.policy, a.can_write, 'agent_id' in a]),
      [[app.id, '앱 방침', true, false]],
    );
    assert.deepEqual(
      (mine.menus as Json[]).map((m) => [m.id, m.app_id, m.can_write]),
      [[menu.id, app.id, true]],
    );
    const missing = await tool(writer, 'blog_menus', { app_id: randomUUID() });
    assert.equal(missing.body.code, 'not_found');
  });

  test('어느 에이전트나 앱 · 메뉴에 놓는다', async () => {
    for (const token of [writer, another]) {
      const intoApp = await draft(token, { app_id: app.id });
      assert.equal(intoApp.ok, true, JSON.stringify(intoApp.body));
      assert.deepEqual(await placeOf(intoApp.body.post_id), { app_id: app.id, menu_id: null });
      const intoMenu = await draft(token, { menu_id: menu.id });
      assert.equal(intoMenu.ok, true, JSON.stringify(intoMenu.body));
      assert.deepEqual(await placeOf(intoMenu.body.post_id), {
        app_id: app.id,
        menu_id: menu.id,
      });
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
      title: '앱 초안',
      body_md: '고친 본문',
      app_id: app.id,
    });
    assert.equal(again.ok, true, JSON.stringify(again.body));
    assert.deepEqual(await placeOf(placed.body.post_id), { app_id: app.id, menu_id: menu.id });
  });

  test('기기도 놓는다 (사람이 연결한 도구)', async () => {
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
