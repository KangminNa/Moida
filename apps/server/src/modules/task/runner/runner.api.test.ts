import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// /api/runners: 보는 사람별 결과 (방문자 · write 기기 · 주인), 러너가 닿은 때와 일 받기 켜기·끄기.
// 러너는 MCP(next_jobs · report_progress)로 닿고, 주인은 REST로 본다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** write 권한을 준 기기의 Bearer 머리글. 관리 일은 이 기기에게도 막혀야 한다 */
let writer: Readonly<Record<string, string>>;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'runner-writer')}` };
});
after(() => api.close());

/** 이 테스트의 일만 보이게 앞 테스트가 남긴 일을 치운다 */
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** 콘솔의 러너 추가로 만든 러너 기기 */
async function newRunner(): Promise<{ id: string; token: string }> {
  return ok(
    await api.request('POST', '/api/devices/runner', owner, {
      requestId: randomUUID(),
      name: `러너-${randomUUID().slice(0, 8)}`,
    }),
    201,
  ) as { id: string; token: string };
}

/** 러너가 MCP 도구 하나를 부른다 */
async function call(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.notEqual(result.isError, true, res.text);
  return result.structuredContent ?? {};
}

async function runnerOf(deviceId: string): Promise<Json | undefined> {
  const { runners } = ok(await api.get('/api/runners', owner)) as { runners: Json[] };
  return runners.find((r) => r.deviceId === deviceId);
}

async function queuedTask(): Promise<Json> {
  const agent = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '러너 시험',
      tool: 'claude',
    }),
    201,
  );
  return ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      instruction: '러너 메뉴 확인',
    }),
    201,
  );
}

describe('러너 (/api/runners)', () => {
  test('방문자와 write 기기는 보지도 바꾸지도 못한다 (403)', async () => {
    for (const headers of [{}, writer]) {
      const list = await api.request('GET', '/api/runners', TestUser.visitor, undefined, headers);
      assert.equal(list.status, 403, list.text);
      const flip = await api.request(
        'POST',
        `/api/runners/${randomUUID()}/accepting`,
        TestUser.visitor,
        { accepting: false, version: 1 },
        headers,
      );
      assert.equal(flip.status, 403, flip.text);
    }
  });

  test('러너가 일을 물으면 목록에 생기고 연결됨으로 보인다', async () => {
    const device = await newRunner();
    assert.equal(await runnerOf(device.id), undefined, '닿기 전에는 없다');
    await call(device.token, 'next_jobs');
    const runner = await runnerOf(device.id);
    assert.equal(runner?.accepting, true, '처음에는 일을 받는다');
    assert.equal(runner?.online, true);
    assert.equal(runner?.task, null);
    assert.ok(Date.now() - new Date(String(runner?.lastSeenAt)).getTime() < 60_000);
  });

  test('ai_login만 물어도 연결됨으로 보인다 (할 수 있는 것을 알리기 전의 러너는 토큰이 없으면 이것만 묻는다)', async () => {
    const device = await newRunner();
    await api.mcp(device.token, 'tools/call', { name: 'ai_login', arguments: { tool: 'claude' } });
    assert.equal((await runnerOf(device.id))?.online, true);
  });

  test('일 받기를 끄면 대기 중인 일이 있어도 빈 목록, 켜면 다시 빌린다. 일하는 중이면 그 일이 보인다', async () => {
    const device = await newRunner();
    await call(device.token, 'next_jobs');
    const before = (await runnerOf(device.id)) as Json;
    const off = ok(
      await api.request('POST', `/api/runners/${before.id}/accepting`, owner, {
        accepting: false,
        version: before.version,
      }),
    );
    assert.equal(off.accepting, false);

    const task = await queuedTask();
    assert.deepEqual((await call(device.token, 'next_jobs')).jobs, [], '끈 러너에게는 주지 않는다');
    assert.equal((await runnerOf(device.id))?.online, true, '꺼도 연결은 그대로');

    const stale = await api.request('POST', `/api/runners/${before.id}/accepting`, owner, {
      accepting: true,
      version: before.version,
    });
    assert.equal(stale.status, 409, '늦은 쓰기는 덮지 않는다');
    ok(
      await api.request('POST', `/api/runners/${before.id}/accepting`, owner, {
        accepting: true,
        version: off.version,
      }),
    );
    const jobs = (await call(device.token, 'next_jobs')).jobs as { task: Json }[];
    assert.equal(jobs[0]?.task.id, task.id);
    assert.deepEqual((await runnerOf(device.id))?.task, {
      id: task.id,
      title: '러너 메뉴 확인',
    });

    // 일하는 동안에는 진행 보고로 닿은 때가 늘어난다
    await db.sql`
      UPDATE task.runners SET last_seen_at = now() - interval '5 minutes'
      WHERE device_id = ${device.id}`;
    assert.equal((await runnerOf(device.id))?.online, false);
    await call(device.token, 'report_progress', { task_id: task.id, events: [] });
    assert.equal((await runnerOf(device.id))?.online, true);
  });

  test('서버 브라우저에 붙은 러너는 browser로 보인다 (O-1): next_jobs가 알린 값, 진행 보고는 그대로, 쥔 브라우저 작업이 있으면 참', async () => {
    const device = await newRunner();
    const task = await queuedTask();
    const jobs = (await call(device.token, 'next_jobs', { browser: true })).jobs as {
      task: Json;
    }[];
    assert.equal(jobs[0]?.task.id, task.id);
    assert.equal((await runnerOf(device.id))?.browser, true, '알린 값');
    await call(device.token, 'report_progress', { task_id: task.id, events: [] });
    assert.equal((await runnerOf(device.id))?.browser, true, '진행 보고는 바꾸지 않는다');
    await call(device.token, 'next_jobs', { browser: false });
    assert.equal((await runnerOf(device.id))?.browser, false, '다음 next_jobs의 값을 따른다');
    // 사이트 일이 도는 동안 러너는 false를 알린다: 쥔 실행 중인 브라우저 작업이 있으면 붙은 러너다
    await db.sql`UPDATE task.tasks SET kind = 'browse' WHERE id = ${String(task.id)}`;
    assert.equal((await runnerOf(device.id))?.browser, true, '쥔 브라우저 작업');
  });

  test('동시에 하는 일 (2026-11-20): 주인이 1~8로 정하면 next_jobs의 답에 실리고, null이면 러너의 기본. 칸은 정하지 못한다', async () => {
    const device = await newRunner();
    assert.equal(
      (await call(device.token, 'next_jobs')).concurrency,
      null,
      '정하기 전은 러너의 기본',
    );
    const runner = (await runnerOf(device.id)) as Json;
    assert.equal(runner.concurrency, null);
    const set = (body: Json) =>
      api.request('POST', `/api/runners/${runner.id}/concurrency`, owner, body);

    const five = ok(await set({ concurrency: 5, version: runner.version }));
    assert.equal(five.concurrency, 5);
    assert.equal(
      (await call(device.token, 'next_jobs')).concurrency,
      5,
      '러너가 다음 빌리기에서 받는다',
    );
    assert.equal(
      (await set({ concurrency: 4, version: runner.version })).status,
      409,
      '본 판이 다르면',
    );
    assert.equal((await set({ concurrency: 9, version: five.version })).status, 400, '1~8');
    assert.equal((await set({ concurrency: 0, version: five.version })).status, 400);
    const reset = ok(await set({ concurrency: null, version: five.version }));
    assert.equal(reset.concurrency, null);
    assert.equal((await call(device.token, 'next_jobs')).concurrency, null);

    for (const headers of [{}, writer]) {
      const denied = await api.request(
        'POST',
        `/api/runners/${runner.id}/concurrency`,
        TestUser.visitor,
        { concurrency: 2, version: reset.version },
        headers,
      );
      assert.equal(denied.status, 403, denied.text);
    }

    const slot = await api.codeRunner('9');
    await call(slot, 'next_jobs');
    const { runners } = ok(await api.get('/api/runners', owner)) as { runners: Json[] };
    const sandbox = runners.find((r) => r.sandbox === true) as Json;
    const refused = await api.request('POST', `/api/runners/${sandbox.id}/concurrency`, owner, {
      concurrency: 2,
      version: sandbox.version,
    });
    assert.equal(refused.status, 422, refused.text);
  });

  test('없는 러너는 404, 모양이 틀리면 400', async () => {
    const missing = await api.request('POST', `/api/runners/${randomUUID()}/accepting`, owner, {
      accepting: false,
      version: 1,
    });
    assert.equal(missing.status, 404, missing.text);
    const shape = await api.request('POST', `/api/runners/${randomUUID()}/accepting`, owner, {
      accepting: 'no',
      version: 1,
    });
    assert.equal(shape.status, 400, shape.text);
  });
});
