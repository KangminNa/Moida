import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { OutboxWorker } from '../modules/platform';
import { ApiClient, TestUser } from './api-client';

// 기능 패키지 browser-tabs의 사이트 도구 (2026-11-16 MCP 2단계, docs/MCP.md 6장).
// 굳히기(도구로 만들기 → browse 작업 → site_build_save 채점 → 켜기 결재), 실행(site_run → site_run_next → site_run_save →
// site_result), 고장(연속 실패), 보는 사람별: 방문자 · write 기기 · 러너 · 에이전트(모두 같은 권한, 2026-11-21) · 관리자.
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

async function newAgent(name: string, actions: string[] = []): Promise<string> {
  const made = await api.request('POST', '/api/agents', owner, {
    requestId: randomUUID(),
    name,
    tool: 'claude',
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
async function building(name: string, more: Json = {}) {
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
      ...more,
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

/** 굳힌 읽기 도구 (시험을 통과하면 승인 없이 바로 켜진다, 2026-11-19). 굳히기 작업은 러너가 끝낸다 */
async function liveTool(name: string): Promise<Json> {
  const { taskId } = await building(name);
  const saved = await save(taskId, [{ price: 1 }, { price: 2 }, { price: 3 }]);
  assert.equal(saved.body.enabled, true, JSON.stringify(saved.body));
  const done = await tool(runner, 'submit_result', {
    task_id: taskId,
    request_id: randomUUID(),
    status: 'done',
    result: { text: '켰어요' },
  });
  assert.equal(done.ok, true, JSON.stringify(done.body));
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
  builder = await newAgent('도구 굳히는 브라우저 담당', ['browser.integration.enable']);
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

  test('읽기 도구는 시험을 통과하면 승인 없이 바로 켜진다 (2026-11-19, 쓰기 도구는 검토 · 켜기 승인)', async () => {
    const live = await liveTool('quote_ok');
    assert.equal(live.status, 'on');
    assert.equal(live.liveSeq, 1);
  });
});

describe('사이트 도구: 실행', () => {
  test('모든 에이전트에게 도구가 보인다 (비공개를 읽어도, 2026-11-21). 맡긴 에이전트가 목록 · 맡기기 · 결과를 쓰고, 결과는 그 에이전트만 본다', async () => {
    await liveTool('quote_run');
    const outbound = await runTokenOf(await newAgent('시세 담당'));
    const other = await runTokenOf(await newAgent('다른 담당'));
    for (const token of [outbound, other])
      assert.ok((await toolNames(token)).includes('site_run'), '모든 에이전트에게 보인다');
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
    const notMine = await tool(other, 'site_result', {
      run_id: asked.body.run_id,
      wait_seconds: 0,
    });
    assert.equal(notMine.ok, false, '맡긴 에이전트만 결과를 본다');
  });

  test('형식과 다른 답은 shape 실패, 세 번 연속 실패면 고장 → 저절로 다시 굳힌다(autoRepair). 그동안 맡기기는 거절 (대신할 길과 함께)', async () => {
    await liveTool('quote_flaky');
    const outbound = await runTokenOf(await newAgent('시세 담당 2'));
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
    assert.equal(flaky.status, 'building', '고장 → 자동 고치기');
    assert.equal(flaky.runsFailed, 3);
    await drain();
    const repairJob = await leased('시세 quote_flaky');
    const part = (await tool(runner, 'browser_job', { task_id: (repairJob.task as Json).id })).body
      .build as Json;
    assert.deepEqual(part.recent_errors, [
      '표를 찾지 못했어요',
      '표를 찾지 못했어요',
      '답이 형식과 달라요: $.price: number이어야 해요',
    ]);
    const refused = await tool(outbound, 'site_run', {
      request_id: 'f4',
      name: 'quote_flaky',
      input: { symbol: '005930' },
    });
    assert.equal(refused.ok, false);
    assert.match(JSON.stringify(refused.body), /browse/);
  });
});

describe('사이트 도구: 되풀이되는 일 (MCP 3단계)', () => {
  test('같은 사이트에서 숫자만 다른 일이 세 번이면 제안, 그만 보기 · 만들기로 닫힌다', async () => {
    const browseAgent = await newAgent('되풀이 브라우저 담당');
    const site = ok(
      await api.request('POST', `${BASE}/sites`, owner, { ...SITE, name: '되풀이 시세' }),
    );
    for (const code of ['005930', '000660', '035720']) {
      const mark = randomUUID().slice(0, 8);
      ok(
        await api.request('POST', `${BASE}/sites/${site.id}/tasks`, owner, {
          requestId: randomUUID(),
          instruction: `${code} 오늘 종가 알려줘 (${mark})`,
          agentId: browseAgent,
        }),
      );
      await drain();
      const job = await leased(mark);
      await tool(runner, 'browser_job', { task_id: (job.task as Json).id });
    }
    const { suggestions } = ok(await api.get(`${BASE}/suggestions`, owner)) as {
      suggestions: Json[];
    };
    const mine = suggestions.find((s) => s.siteId === site.id);
    assert.equal(mine, undefined, '표시(괄호 안 글자)가 달라 열쇠가 다르면 세지 않는다');
  });

  test('지시가 같은 모양이면 세 번째에 제안이 열리고, 만들기에 제안을 넘기면 닫힌다', async () => {
    const browseAgent = await newAgent('되풀이 담당 2');
    const site = ok(
      await api.request('POST', `${BASE}/sites`, owner, { ...SITE, name: '되풀이 2' }),
    );
    for (const code of ['005930', '000660', '035720']) {
      ok(
        await api.request('POST', `${BASE}/sites/${site.id}/tasks`, owner, {
          requestId: randomUUID(),
          instruction: `${code} 오늘 종가 알려줘`,
          agentId: browseAgent,
        }),
      );
      await drain();
      const job = await leased('되풀이 2');
      await tool(runner, 'browser_job', { task_id: (job.task as Json).id });
    }
    const listed1 = ok(await api.get(`${BASE}/suggestions`, owner)) as { suggestions: Json[] };
    const open = listed1.suggestions.find((s) => s.siteId === site.id);
    assert.equal(open?.count, 3);
    for (const headers of [{}, writer])
      assert.equal(
        (await api.request('GET', `${BASE}/suggestions`, TestUser.visitor, undefined, headers))
          .status,
        403,
      );
    ok(
      await api.request('POST', `${BASE}/integrations`, owner, {
        requestId: randomUUID(),
        siteId: site.id,
        name: 'repeat_close',
        title: '종가',
        description: '종목 코드로 종가를 읽는다',
        hint: String(open?.sample),
        suggestionId: open?.id,
      }),
    );
    const listed2 = ok(await api.get(`${BASE}/suggestions`, owner)) as { suggestions: Json[] };
    assert.equal(
      listed2.suggestions.find((s) => s.siteId === site.id),
      undefined,
      '만들었으면 닫힘',
    );
  });
});

describe('사이트 도구: 쓰기 도구 · 검토자 짝 (MCP 3단계)', () => {
  test('쓰기 도구는 검토자가 있어야 하고, 굳힌 에이전트와 같으면 안 된다 (422)', async () => {
    const site = ok(await api.request('POST', `${BASE}/sites`, owner, SITE));
    const body = {
      requestId: randomUUID(),
      siteId: site.id,
      name: 'write_bad',
      title: '글 올리기',
      description: '제목과 본문으로 글을 올린다',
      mode: 'write',
      agentId: builder,
    };
    assert.equal((await api.request('POST', `${BASE}/integrations`, owner, body)).status, 422);
    const same = await api.request('POST', `${BASE}/integrations`, owner, {
      ...body,
      reviewerId: builder,
    });
    assert.equal(same.status, 422);
  });

  test('마른 실행 시험 → 검토 → 고칠 점이면 다시 굳히고, 통과면 검토자가 켜기 결재 → 부를 때마다 결재 → 한 번 실행', async () => {
    const reviewer = await newAgent('사이트 도구 검토자', ['browser.integration.enable']);
    const { taskId } = await building('post_write', { mode: 'write', reviewerId: reviewer });
    const dry = await save(taskId, [{}, {}, {}]);
    assert.deepEqual([dry.body.accepted, dry.body.review], [true, true], JSON.stringify(dry.body));
    const tool1 = await listed('post_write');
    assert.equal(tool1.status, 'reviewing');
    await drain();
    const reviewJob = await leased('사이트 도구 검토: 시세 post_write');
    const reviewRun = String(reviewJob.run_token);
    const material = await tool(reviewRun, 'site_review_get', { integration_id: tool1.id });
    assert.equal(material.body.mode, 'write');
    const stranger = await runTokenOf(await newAgent('검토자 아님'));
    assert.equal((await tool(stranger, 'site_review_get', { integration_id: tool1.id })).ok, false);

    const fix = await tool(reviewRun, 'site_review', {
      integration_id: tool1.id,
      seq: material.body.seq,
      verdict: 'fix',
      notes: 'commit 전에 제목 칸을 비우지 않아요',
    });
    assert.equal(fix.body.verdict, 'fix');
    assert.equal((await listed('post_write')).status, 'building');
    await drain();
    const again = await leased('시세 post_write');
    const dry2 = await save(String((again.task as Json).id), [{}, {}, {}]);
    assert.equal(dry2.body.accepted, true);
    await drain();
    const review2 = String((await leased('사이트 도구 검토: 시세 post_write')).run_token);
    const pass = await tool(review2, 'site_review', {
      integration_id: tool1.id,
      seq: dry2.body.seq,
      verdict: 'pass',
      notes: '입력만 쓰고 commit 한 번',
    });
    const enable = pass.body.approval as Json;
    assert.equal(enable.action, 'browser.integration.enable');
    const asked = await tool(review2, 'request_approval', {
      request_id: 'enable-post-write',
      action: enable.action,
      target_kind: enable.target_kind,
      target_id: enable.target_id,
      target_version: enable.target_version,
      note: '검토 통과',
    });
    const approval = ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
        version: approval.version,
        decision: 'approve',
      }),
    );
    await drain();
    assert.equal((await listed('post_write')).status, 'on');

    const writerAgent = await newAgent('글 올리는 담당', ['browser.integration.write']);
    const caller = await runTokenOf(writerAgent);
    const held = await tool(caller, 'site_run', {
      request_id: 'w1',
      name: 'post_write',
      input: { symbol: 'hello' },
    });
    assert.equal(held.body.status, 'held');
    assert.equal((await tool(runner, 'site_run_next')).body.run, null, '결재 전에는 꺼내지 않는다');
    const write = held.body.approval as Json;
    const askedWrite = await tool(caller, 'request_approval', {
      request_id: 'write-w1',
      action: write.action,
      target_kind: write.target_kind,
      target_id: write.target_id,
      target_version: write.target_version,
      note: '입력: hello',
    });
    const writeApproval = ok(await api.get(`/api/approvals/${askedWrite.body.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${writeApproval.id}/decide`, owner, {
        version: writeApproval.version,
        decision: 'approve',
      }),
    );
    await drain();
    const next = (await tool(runner, 'site_run_next')).body.run as Json;
    assert.deepEqual([next.id, next.mode], [held.body.run_id, 'write']);
    await tool(runner, 'site_run_save', { run_id: next.id, status: 'done', output: { price: 1 } });
    await drain();
    // 승인한 실행이 끝나면 기다리던 작업도 끝난다 (다른 결재와 같다): 결과는 관리자 화면에서 본다
    const detail = ok(
      await api.get(`${BASE}/integrations/${(await listed('post_write')).id}`, owner),
    );
    const ran = (detail.runs as Json[]).find((r) => r.id === held.body.run_id) as Json;
    assert.equal(ran.status, 'done');
    const ended = await api.mcp(caller, 'tools/call', { name: 'site_tools', arguments: {} });
    assert.equal(ended.status, 401, '작업이 끝나 작업 토큰도 끝났다');
  });
});
