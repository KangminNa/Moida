import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { OutboxWorker } from '../modules/platform';
import { ApiClient, TestUser } from './api-client';

// 기능 패키지 browser-tabs의 사이트 도구 (2026-11-16 MCP 2단계, docs/MCP.md 6장).
// 굳히기(도구로 만들기 → browse 작업 → site_build_save 채점 → 켜기 결재), 실행(site_run → site_run_next → site_run_save →
// site_result), 고장(연속 실패), 보는 사람별: 방문자 · write 기기 · 러너 · 바깥으로 보내는 에이전트 · 비공개를 읽는 에이전트 · 관리자.
// 코드는 돌리지 않는다 (러너 쪽은 apps/runner의 시험이 본다)

type Json = Record<string, unknown>;
const BASE = '/api/p/browser-tabs';
const SITE = {
  name: '시세',
  startUrl: 'https://quotes.example/',
  origins: ['https://quotes.example'],
};
const INPUT = {
  type: 'object',
  properties: { symbol: { type: 'string', maxLength: 10 } },
  required: ['symbol'],
  additionalProperties: false,
};
const OUTPUT = {
  type: 'object',
  properties: { price: { type: 'number' } },
  required: ['price'],
};
const CODE = "await page.goto(site.origin + '/q/' + input.symbol);\nreturn { price: 1 };";

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
let runner: string;
let builder: string;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};
const drain = async () => {
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
};

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

async function toolNames(token: string): Promise<string[]> {
  const res = await api.mcp(token, 'tools/list', {});
  return (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
}

async function newAgent(name: string, scopes: string[], actions: string[] = []): Promise<string> {
  const made = await api.request('POST', '/api/agents', owner, {
    requestId: randomUUID(),
    name,
    tool: 'claude',
    scopes,
    approvalActions: actions,
  });
  return String(ok(made, 201).id);
}

/** 제목에 표시가 든 일을 러너가 빌린다 (다른 시험이 남긴 일이 먼저 올 수 있다) */
async function leased(mark: string): Promise<Json> {
  for (let round = 0; round < 20; round++) {
    const next = await tool(runner, 'next_jobs', {
      wait_seconds: 0,
      limit: 10,
      tools: ['claude'],
      own_logins: ['claude'],
      browser: true,
    });
    const job = (next.body.jobs as Json[]).find((j) =>
      String((j.task as Json).title).includes(mark),
    );
    if (job) return job;
  }
  throw new Error(`빌린 일이 없다: ${mark}`);
}

/** 에이전트에게 일반 일을 맡기고 빌려 그 작업 토큰을 받는다 */
async function runTokenOf(agentId: string): Promise<string> {
  const mark = randomUUID().slice(0, 8);
  ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId,
      title: `시세 조사 ${mark}`,
      instruction: '오늘 시세',
    }),
    201,
  );
  return String((await leased(mark)).run_token);
}

/** 도구로 만들기 → 굳히기 작업을 러너가 빌린다 */
async function building(name: string) {
  const site = ok(await api.request('POST', `${BASE}/sites`, owner, SITE));
  ok(
    await api.request('POST', `${BASE}/integrations`, owner, {
      requestId: randomUUID(),
      siteId: site.id,
      name,
      title: `시세 ${name}`,
      description: '종목 코드로 오늘 종가를 읽는다',
      hint: '지시: 005930 종가 / 답: 71,000원',
      agentId: builder,
    }),
  );
  await drain();
  const job = await leased(`시세 ${name}`);
  return { site, job, taskId: String((job.task as Json).id), run: String(job.run_token) };
}

const tests = (outputs: (Json | null)[]) =>
  outputs.map((output, i) => ({
    name: `시험 ${i}`,
    input: { symbol: `00${i}` },
    ...(output ? { output } : { error: '버튼을 찾지 못했어요' }),
    ms: 900,
  }));

const save = (taskId: string, outputs: (Json | null)[], more: Json = {}) =>
  tool(runner, 'site_build_save', {
    task_id: taskId,
    input_schema: INPUT,
    output_schema: OUTPUT,
    code: CODE,
    tests: tests(outputs),
    ...more,
  });

const listed = async (name: string): Promise<Json> => {
  const { integrations } = ok(await api.get(`${BASE}/integrations`, owner)) as {
    integrations: Json[];
  };
  const found = integrations.find((i) => i.name === name);
  assert.ok(found, name);
  return found;
};

/** 굳히고 켜기 결재를 승인해 켠 도구 */
async function liveTool(name: string): Promise<Json> {
  const { taskId, run } = await building(name);
  const saved = await save(taskId, [{ price: 1 }, { price: 2 }, { price: 3 }]);
  const asked = await tool(run, 'request_approval', {
    request_id: `enable-${name}`,
    action: 'browser.integration.enable',
    target_kind: 'browser_integration',
    target_id: (await listed(name)).id,
    target_version: saved.body.integration_version,
    note: '시험 3/3',
  });
  assert.equal(asked.ok, true, JSON.stringify(asked.body));
  const approval = ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner));
  ok(
    await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
      version: approval.version,
      decision: 'approve',
    }),
  );
  await drain();
  return listed(name);
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'site-tools-writer')}` };
  const made = await api.request('POST', '/api/devices/runner', owner, {
    requestId: randomUUID(),
    name: '사이트 도구 러너',
  });
  runner = String(ok(made, 201).token);
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  ok(await api.request('POST', '/api/plugins/browser-tabs/enable', owner));
  builder = await newAgent(
    '도구 굳히는 브라우저 담당',
    ['read_public', 'browse'],
    ['browser.integration.enable'],
  );
});
after(async () => {
  await api.request('POST', '/api/plugins/browser-tabs/disable', owner);
  await api.close();
});

describe('사이트 도구: 굳히기', () => {
  test('방문자 · write 기기는 도구를 보거나 만들지 못한다 (403). 이름 규칙 422, 같은 이름 409', async () => {
    for (const headers of [{}, writer]) {
      const list = await api.request(
        'GET',
        `${BASE}/integrations`,
        TestUser.visitor,
        undefined,
        headers,
      );
      assert.equal(list.status, 403, list.text);
      const make = await api.request('POST', `${BASE}/integrations`, TestUser.visitor, {}, headers);
      assert.equal(make.status, 403, make.text);
    }
    const site = ok(await api.request('POST', `${BASE}/sites`, owner, SITE));
    const body = { requestId: randomUUID(), siteId: site.id, title: '시세', description: '종가' };
    assert.equal(
      (await api.request('POST', `${BASE}/integrations`, owner, { ...body, name: 'Bad-Name' }))
        .status,
      422,
    );
    ok(await api.request('POST', `${BASE}/integrations`, owner, { ...body, name: 'dup_tool' }));
    const again = await api.request('POST', `${BASE}/integrations`, owner, {
      ...body,
      requestId: randomUUID(),
      name: 'dup_tool',
    });
    assert.equal(again.status, 409, again.text);
  });

  test('굳히기 작업의 browser_job에 굳히기 몫이 오고, 70% 미만이면 버전만 남고 굳히는 중으로 둔다', async () => {
    const { taskId } = await building('quote_low');
    const job = await tool(runner, 'browser_job', { task_id: taskId });
    assert.equal(job.body.mode, 'site');
    const build = job.body.build as Json;
    assert.equal(build.name, 'quote_low');
    assert.equal(build.last, null);
    const badSchema = await save(taskId, [{ price: 1 }, { price: 1 }, { price: 1 }], {
      input_schema: { type: 'object', $ref: '#/x' },
    });
    assert.equal(badSchema.ok, false);
    const few = await save(taskId, [{ price: 1 }, { price: 1 }]);
    assert.equal(few.ok, false, '시험은 3개부터');
    const low = await save(taskId, [{ price: 1 }, { price: 'x' }, null]);
    assert.equal(low.body.accepted, false);
    assert.equal(low.body.passed, 1);
    assert.equal((low.body.problems as Json[]).length, 2);
    assert.equal((await listed('quote_low')).status, 'building');
    const detail = ok(
      await api.get(`${BASE}/integrations/${(await listed('quote_low')).id}`, owner),
    );
    assert.equal((detail.revisions as Json[])[0]?.seq, 1);
  });

  test('통과하면 켜기 결재로 켜고 작업이 끝난다. 결재 뒤 바뀐 도구는 켜지 않는다', async () => {
    const live = await liveTool('quote_ok');
    assert.equal(live.status, 'on');
    assert.equal(live.liveSeq, 1);
    const { taskId, run } = await building('quote_stale');
    const saved = await save(taskId, [{ price: 1 }, { price: 2 }, { price: 3 }]);
    assert.equal(saved.body.accepted, true);
    const asked = await tool(run, 'request_approval', {
      request_id: 'enable-stale',
      action: 'browser.integration.enable',
      target_kind: 'browser_integration',
      target_id: (await listed('quote_stale')).id,
      target_version: Number(saved.body.integration_version) - 1,
      note: '낡은 판',
    });
    const approval = ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
        version: approval.version,
        decision: 'approve',
      }),
    );
    await drain();
    assert.equal((await listed('quote_stale')).status, 'review');
    const task = ok(await api.get(`/api/tasks/${taskId}`, owner));
    assert.equal(task.status, 'failed');
  });
});

describe('사이트 도구: 실행', () => {
  test('비공개를 읽는 에이전트에게는 도구가 보이지 않고, 바깥으로 보내는 에이전트는 목록 · 맡기기 · 결과를 쓴다', async () => {
    await liveTool('quote_run');
    const outbound = await runTokenOf(await newAgent('시세 담당', ['read_public']));
    const keeper = await runTokenOf(await newAgent('비공개 담당', ['read_public', 'read_all']));
    assert.ok((await toolNames(outbound)).includes('site_run'));
    assert.equal((await toolNames(keeper)).includes('site_run'), false);
    const listedTools = await tool(outbound, 'site_tools');
    const mine = (listedTools.body.tools as Json[]).find((t) => t.name === 'quote_run');
    assert.deepEqual(mine?.input_schema, INPUT);

    const wrong = await tool(outbound, 'site_run', {
      request_id: 'r0',
      name: 'quote_run',
      input: { symbol: 1 },
    });
    assert.equal(wrong.ok, false);
    const asked = await tool(outbound, 'site_run', {
      request_id: 'r1',
      name: 'quote_run',
      input: { symbol: '005930' },
    });
    assert.equal(asked.body.status, 'queued');
    const same = await tool(outbound, 'site_run', {
      request_id: 'r1',
      name: 'quote_run',
      input: { symbol: '005930' },
    });
    assert.equal(same.body.run_id, asked.body.run_id, '같은 request_id는 한 번만');

    const next = await tool(runner, 'site_run_next');
    const run = next.body.run as Json;
    assert.equal(run.id, asked.body.run_id);
    assert.equal(run.code, CODE);
    assert.deepEqual((run.site as Json).origins, SITE.origins);
    const saved = await tool(runner, 'site_run_save', {
      run_id: run.id,
      status: 'done',
      output: { price: 71000 },
    });
    assert.equal(saved.body.status, 'done', JSON.stringify(saved.body));
    const result = await tool(outbound, 'site_result', {
      run_id: asked.body.run_id,
      wait_seconds: 0,
    });
    assert.deepEqual([result.body.status, result.body.output], ['done', { price: 71000 }]);
    const other = await tool(
      await runTokenOf(await newAgent('다른 담당', ['read_public'])),
      'site_result',
      {
        run_id: asked.body.run_id,
        wait_seconds: 0,
      },
    );
    assert.equal(other.ok, false, '맡긴 에이전트만 결과를 본다');
  });

  test('형식과 다른 답은 shape 실패, 세 번 연속 실패면 고장으로 두고 맡기기를 거절한다 (대신할 길과 함께)', async () => {
    await liveTool('quote_flaky');
    const outbound = await runTokenOf(await newAgent('시세 담당 2', ['read_public']));
    for (const i of [1, 2, 3]) {
      const asked = await tool(outbound, 'site_run', {
        request_id: `f${i}`,
        name: 'quote_flaky',
        input: { symbol: '005930' },
      });
      const run = (await tool(runner, 'site_run_next')).body.run as Json;
      assert.equal(run.id, asked.body.run_id);
      const saved = await tool(
        runner,
        'site_run_save',
        i === 1
          ? { run_id: run.id, status: 'done', output: { price: 'x' } }
          : { run_id: run.id, status: 'failed', error: '표를 찾지 못했어요', error_kind: 'code' },
      );
      assert.equal(saved.body.status, 'failed');
    }
    const flaky = await listed('quote_flaky');
    assert.equal(flaky.status, 'broken');
    assert.equal(flaky.runsFailed, 3);
    const refused = await tool(outbound, 'site_run', {
      request_id: 'f4',
      name: 'quote_flaky',
      input: { symbol: '005930' },
    });
    assert.equal(refused.ok, false);
    assert.match(JSON.stringify(refused.body), /browse/);
  });
});
