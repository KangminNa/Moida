import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 에이전트를 러너에 묶기 (2026-11-14): 묶인 에이전트의 일은 그 러너만 빌린다 (꺼져 있으면 기다린다).
// 코드 러너 칸에는 묶지 않는다. 칸의 일(make · code)은 묶임과 상관없이 칸 러너가 빌린다 (2026-11-21, 같은 일꾼).
// 대표는 묶인 일꾼을 안다 (bound).

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** 러너 둘 (run 권한 기기): 내 컴퓨터(mine)와 서버(server) */
const tokens: Record<string, string> = {};
/** task.runners의 id */
const runnerIds: Record<string, string> = {};

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function jobs(token: string): Promise<Json[]> {
  const res = await api.mcp(token, 'tools/call', { name: 'next_jobs', arguments: {} });
  assert.equal(res.status, 200, res.text);
  return (res.json().result as Json).structuredContent?.jobs ?? [];
}

const agent = async (name: string, more: Json = {}) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `${name} ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      ...more,
    }),
    201,
  );
const current = async (id: unknown) =>
  (ok(await api.get('/api/agents', owner)).agents as Json[]).find((a) => a.id === id) as Json;
const patch = async (id: unknown, body: Json) =>
  api.request('PATCH', `/api/agents/${id}`, owner, {
    version: (await current(id)).version,
    ...body,
  });
const task = async (agentId: unknown, more: Json = {}) =>
  ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId,
      instruction: '일',
      ...more,
    }),
    201,
  );

async function runner(name: string): Promise<string> {
  const token = await api.connectDevice(owner, name);
  const { devices } = ok(await api.get('/api/devices', owner));
  const device = (devices as Json[]).find((d) => d.name === name) as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  return token;
}

/** 러너가 처음 닿으면 줄이 생긴다. 기기 id로 줄의 id를 찾는다 */
async function rowOf(token: string, deviceName: string): Promise<string> {
  await jobs(token);
  const { devices } = ok(await api.get('/api/devices', owner));
  const device = (devices as Json[]).find((d) => d.name === deviceName) as Json;
  const { runners } = ok(await api.get('/api/runners', owner));
  return (runners as Json[]).find((r) => r.deviceId === device.id)?.id;
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '러너', siteUrl: api.baseUrl, version });
  for (const name of ['mine', 'server']) {
    tokens[name] = await runner(`pin-${name}`);
    runnerIds[name] = await rowOf(tokens[name] as string, `pin-${name}`);
  }
  // 대표는 첫 대화에서 생긴다 (같은 DB를 쓰는 앞 파일이 이미 만들었을 수 있다). 그 회차는 beforeEach가 치운다
  if (!ok(await api.get('/api/agents/lead', owner)).lead)
    ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '대표를 만드는 첫 대화',
      }),
      201,
    );
});
after(() => api.close());

/** 이 테스트의 일만 빌려 가게 앞 테스트가 남긴 일을 치운다 */
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('에이전트를 러너에 묶기', () => {
  test('방문자 · write 기기는 묶지 못한다 (403)', async () => {
    const a = await agent('남의');
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `pin-writer-${randomUUID().slice(0, 6)}`)}`,
    };
    for (const headers of [{}, writer]) {
      const res = await api.request(
        'PATCH',
        `/api/agents/${a.id}`,
        TestUser.visitor,
        { version: a.version, runnerId: runnerIds.mine },
        headers,
      );
      assert.equal(res.status, 403, res.text);
    }
  });

  test('묶인 에이전트의 일은 그 러너만 빌린다. 풀면 아무 러너나', async () => {
    const a = await agent('내 컴퓨터');
    const pinned = ok(await patch(a.id, { runnerId: runnerIds.mine }));
    assert.equal(pinned.runnerId, runnerIds.mine);
    assert.equal(pinned.settingsRevision, a.settingsRevision + 1, '설정 판이 오른다');

    const t = await task(a.id);
    assert.deepEqual(await jobs(tokens.server as string), [], '다른 러너는 빌리지 않는다');
    const mine = await jobs(tokens.mine as string);
    assert.deepEqual(
      mine.map((j) => j.task.id),
      [t.id],
    );

    assert.equal(mine[0]?.agent.bound, true, '러너가 나눈 폴더를 여는 표시');

    ok(await patch(a.id, { runnerId: null }));
    const t2 = await task(a.id);
    const server = await jobs(tokens.server as string);
    assert.deepEqual(
      server.map((j) => j.task.id),
      [t2.id],
    );
    assert.equal(server[0]?.agent.bound, false);
  });

  test('만들 때 묶을 수 있고, 대표는 묶인 일꾼을 안다 (bound)', async () => {
    const lead = ok(await api.get('/api/agents/lead', owner)).lead as Json;
    const member = await agent('내 폴더', { runnerId: runnerIds.mine });
    assert.equal(member.runnerId, runnerIds.mine);
    await task(lead.id);
    const [job] = await jobs(tokens.server as string);
    assert.equal(job?.agent.id, lead.id, '대표의 일');
    const seen = ((job?.team ?? []) as Json[]).find((m) => m.agent_id === member.id);
    assert.equal(seen?.bound, true);
  });

  test('칸에는 묶지 않는다 (422). 없는 러너는 404', async () => {
    const slot = await api.codeRunner('7');
    await jobs(slot);
    const { runners } = ok(await api.get('/api/runners', owner));
    const sandbox = (runners as Json[]).find((r) => r.sandbox === true);
    assert.ok(sandbox, '칸은 sandbox로 남는다');
    assert.equal((runners as Json[]).find((r) => r.id === runnerIds.mine)?.sandbox, false);

    const a = await agent('일반');
    assert.equal((await patch(a.id, { runnerId: sandbox.id })).status, 422);
    assert.equal((await patch(a.id, { runnerId: randomUUID() })).status, 404);
    const bound = ok(await patch(a.id, { runnerId: runnerIds.mine }));
    assert.equal(
      bound.runnerId,
      runnerIds.mine,
      'make · code 권한이 있어도 묶인다 (모든 에이전트가 같은 권한)',
    );
  });

  test('묶인 에이전트의 만들기(make) 일은 칸 러너가 빌리고, 다른 일은 묶인 러너만 빌린다 (2026-11-21)', async () => {
    const slot = await api.codeRunner('7');
    const a = await agent('묶인 일꾼', { runnerId: runnerIds.mine });
    const general = await task(a.id);
    const made = await task(a.id, { kind: 'make', instruction: '발표 슬라이드 세 장' });

    assert.deepEqual(
      await jobs(tokens.server as string),
      [],
      '다른 러너는 어느 일도 빌리지 않는다',
    );
    assert.deepEqual(
      (await jobs(slot)).map((j) => j.task.id),
      [made.id],
      '칸은 묶임과 상관없이 칸의 일만',
    );
    assert.deepEqual(
      (await jobs(tokens.mine as string)).map((j) => j.task.id),
      [general.id],
      '묶인 러너는 칸의 일을 빌리지 않는다',
    );
  });
});

describe('모델 · 생각 강도 (2차 7단계)', () => {
  test('정한 값은 목록 · 설정 판에 남고 일과 함께 러너에게 간다. 비우면 CLI의 기본', async () => {
    const a = await agent('강도', { model: 'opus', effort: 'max' });
    assert.deepEqual([a.model, a.effort], ['opus', 'max']);
    await task(a.id);
    const [job] = await jobs(tokens.mine as string);
    assert.deepEqual([job?.agent?.model, job?.agent?.effort], ['opus', 'max']);
    const cleared = ok(await patch(a.id, { model: '', effort: '' }));
    assert.deepEqual([cleared.model, cleared.effort], ['', '']);
    const { revisions } = ok(await api.get(`/api/agents/${a.id}/revisions`, owner));
    assert.equal((revisions as Json[]).find((r) => r.revision === 1)?.settings.effort, 'max');
  });

  test('도구가 받지 않는 강도 · 설정 파일에 못 쓰는 모델 이름은 422', async () => {
    const a = await agent('강도 규칙', { effort: 'max' });
    assert.equal((await patch(a.id, { tool: 'codex' })).status, 422, 'Codex는 max가 없다');
    assert.equal((await patch(a.id, { model: 'opus "x"' })).status, 422);
    assert.equal((await patch(a.id, { effort: 'huge' })).status, 422);
    ok(await patch(a.id, { tool: 'codex', effort: 'high' }));
  });
});
