import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Database, OutboxWorker } from '../modules/platform';
import { ApiClient, TestUser } from './api-client';

// 기능 패키지 browser-tabs의 브라우저 에이전트 (2차 3단계 서버 브라우저 목표, 2026-11-14).
// 사이트 일 · 둘러보기 맡기기, 러너의 browser_job · 단계 화면 · 로그인 필요 · 결재된 클릭(붙잡기 → 승인 → 누르기 · 바뀜),
// 세션 지우기, 브라우저 일의 위임 규칙(대표만 맡긴다). 보는 사람별: 방문자 · write 기기 · 러너(쥔 · 쥐지 않은) · 에이전트 · 관리자.
// 브라우저는 없다 (러너 쪽은 apps/runner의 단위 · 통합 테스트가 진짜 Chromium으로 본다).

type Json = Record<string, unknown>;
const BASE = '/api/p/browser-tabs';
const SITE = {
  name: '시험 블로그',
  startUrl: 'https://blog.example/write',
  origins: ['https://blog.example'],
};
/** 앞부분만 JPEG인 작은 그림 (서버는 형식을 앞부분으로 본다) */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
const FINGERPRINT = 'a'.repeat(64);

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
let runner: string;
let other: string;
let agentId: string;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};
const drain = async () => {
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
};

async function tool(
  token: string,
  name: string,
  args: Json = {},
): Promise<{ ok: boolean; body: Json }> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') }
    : { ok: true, body: result.structuredContent ?? {} };
}

async function newRunner(name: string): Promise<string> {
  const made = await api.request('POST', '/api/devices/runner', owner, {
    requestId: randomUUID(),
    name,
  });
  return String(ok(made, 201).token);
}

async function newAgent(name: string, more: Json = {}): Promise<string> {
  const made = await api.request('POST', '/api/agents', owner, {
    requestId: randomUUID(),
    name,
    tool: 'claude',
    approvalActions: ['browser.site.publish', 'browser.site.login'],
    ...more,
  });
  return String(ok(made, 201).id);
}

const newSite = async (): Promise<Json> =>
  ok(await api.request('POST', `${BASE}/sites`, owner, SITE));

/** 맡긴 일(제목에 표시)을 러너가 빌린다. 같은 DB의 다른 시험이 남긴 일이 먼저 올 수 있어 그 일이 올 때까지 */
async function leased(mark: string, token = runner): Promise<Json> {
  for (let round = 0; round < 20; round++) {
    const next = await tool(token, 'next_jobs', {
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

/** 사이트에 일을 맡기고 러너가 빌린다 */
async function siteJob(site: Json): Promise<{ job: Json; taskId: string; run: string }> {
  const mark = randomUUID().slice(0, 8);
  ok(
    await api.request('POST', `${BASE}/sites/${site.id}/tasks`, owner, {
      requestId: randomUUID(),
      instruction: `글을 채워 주세요 ${mark}`,
      agentId,
    }),
  );
  await drain();
  const job = await leased(mark);
  return { job, taskId: String((job.task as Json).id), run: String(job.run_token) };
}

const hold = (taskId: string, more: Json = {}) =>
  tool(runner, 'browser_click_hold', {
    task_id: taskId,
    tab_id: 'A'.repeat(32),
    page_url: 'https://blog.example/write?draft=1',
    page_title: '글쓰기',
    role: 'button',
    name: '게시',
    nth: 0,
    box: { x: 10, y: 20, width: 80, height: 30 },
    fingerprint: FINGERPRINT,
    note: '제목과 본문을 채웠어요',
    image: JPEG,
    ...more,
  });

/** 붙잡고 러너가 작업 토큰으로 클릭 결재를 올린다 */
async function heldClick(
  taskId: string,
  run: string,
): Promise<{ clickId: string; approval: Json }> {
  const held = await hold(taskId);
  assert.equal(held.ok, true, JSON.stringify(held.body));
  const asked = await tool(run, 'request_approval', {
    request_id: `click-${held.body.click_id}`,
    action: 'browser.site.publish',
    target_kind: 'browser_click',
    target_id: held.body.click_id,
    target_version: held.body.version,
    note: '게시 버튼',
  });
  assert.equal(asked.ok, true, JSON.stringify(asked.body));
  const approval = ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner));
  return { clickId: String(held.body.click_id), approval };
}

const decide = async (approval: Json, decision: string, note?: string) => {
  ok(
    await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
      version: approval.version,
      decision,
      ...(note ? { note } : {}),
    }),
  );
  await drain();
};
const taskOf = async (id: string): Promise<Json> => ok(await api.get(`/api/tasks/${id}`, owner));
const clickOf = async (id: string): Promise<Json> =>
  ok(await api.get(`${BASE}/clicks/${id}`, owner));

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'browser-writer')}` };
  runner = await newRunner('브라우저 러너');
  other = await newRunner('다른 러너');
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  ok(await api.request('POST', '/api/plugins/browser-tabs/enable', owner));
  agentId = await newAgent('브라우저 담당');
});
after(async () => {
  // 다음 시험 파일이 보는 도구 목록이 패키지 상태에 흔들리지 않게 끄고 끝낸다
  await api.request('POST', '/api/plugins/browser-tabs/disable', owner);
  await api.close();
});

describe('브라우저 에이전트: 관리자 입구', () => {
  test('방문자 · write 기기는 사이트 · 둘러보기 · 클릭 · 화면 · 세션 지우기를 못 한다 (403)', async () => {
    const id = randomUUID();
    const calls = [
      ['GET', `${BASE}/sites`, undefined],
      ['POST', `${BASE}/sites`, SITE],
      ['POST', `${BASE}/explore`, { requestId: randomUUID(), instruction: '가격 비교' }],
      ['POST', `${BASE}/sites/${id}/clear-session`, {}],
      ['GET', `${BASE}/clicks`, undefined],
      ['GET', `${BASE}/clicks/${id}`, undefined],
      ['POST', `${BASE}/clicks/${id}/manual`, { version: 1, done: true }],
      ['GET', `${BASE}/shots?taskId=${id}`, undefined],
      ['GET', `${BASE}/shots/${id}`, undefined],
      ['GET', `${BASE}/screen`, undefined],
    ] as const;
    for (const [method, path, body] of calls)
      for (const headers of [{}, writer]) {
        const res = await api.request(method, path, TestUser.visitor, body, headers);
        assert.equal(res.status, 403, `${method} ${path}: ${res.text}`);
      }
  });

  test('사이트는 관리자만 등록하고 출처 모양 · 시작 주소를 본다. 로그인 필요 표시는 비어 있다', async () => {
    const site = await newSite();
    assert.deepEqual(site.origins, ['https://blog.example']);
    assert.equal(site.loginNeededAt, null);
    for (const bad of [
      { ...SITE, origins: ['https://blog.example/path'] },
      { ...SITE, origins: ['*.example.com'] },
      { ...SITE, startUrl: 'https://other.example/' },
    ])
      assert.equal((await api.request('POST', `${BASE}/sites`, owner, bad)).status, 422);
    const path = `${BASE}/sites/${site.id}`;
    const changed = ok(
      await api.request('PATCH', path, owner, { version: site.version, name: '새 이름' }),
    );
    assert.equal(
      (await api.request('PATCH', path, owner, { version: site.version, name: 'x' })).status,
      409,
    );
    ok(await api.request('DELETE', path, owner, { version: changed.version }));
  });

  test('영상의 관리자 확인(GET /viewer)은 없다. 화면 · 세션 지우기는 브라우저가 없으면 502', async () => {
    assert.equal((await api.request('GET', `${BASE}/viewer`, owner)).status, 404);
    const none = await api.request('GET', `${BASE}/screen`, owner);
    assert.equal(none.status, 502, none.text);
    const site = await newSite();
    const clear = await api.request('POST', `${BASE}/sites/${site.id}/clear-session`, owner, {});
    assert.equal(clear.status, 502, clear.text);
    assert.match(clear.text, /서버 브라우저가 꺼져 있거나/);
    const missing = await api.request(
      'POST',
      `${BASE}/sites/${randomUUID()}/clear-session`,
      owner,
      {},
    );
    assert.equal(missing.status, 404);
  });

  test('둘러보기를 맡기면 대상 없는 browse 작업이 되고, 러너에게는 explore. 누르기는 거절', async () => {
    const mark = randomUUID().slice(0, 8);
    ok(
      await api.request('POST', `${BASE}/explore`, owner, {
        requestId: randomUUID(),
        instruction: `노트북 가격 비교 ${mark}`,
        agentId,
      }),
    );
    await drain();
    const job = await leased(mark);
    const task = job.task as Json;
    assert.equal(task.kind, 'browse');
    assert.match(String(task.title), /^둘러보기: 노트북 가격 비교/);
    assert.equal((job.target as Json | null)?.kind ?? null, null);
    const plan = await tool(runner, 'browser_job', { task_id: task.id });
    assert.deepEqual(plan.body, {
      mode: 'explore',
      site: null,
      login_needed: false,
      held: null,
      build: null,
      click_plan: null,
    });
    const held = await hold(String(task.id));
    assert.equal(held.ok, false);
    assert.match(JSON.stringify(held.body), /둘러보기에서는/);
  });

  test('등록 없이 (2026-11-19): 둘러보기가 로그인 화면을 만나면 그 출처로 사이트가 생기고, "로그인했어요" 뒤에 같은 작업이 사이트 일로 이어진다', async () => {
    const mark = randomUUID().slice(0, 8);
    ok(
      await api.request('POST', `${BASE}/explore`, owner, {
        requestId: randomUUID(),
        instruction: `shop-${mark}.example에서 내 주문 목록 정리`,
        agentId,
      }),
    );
    await drain();
    const job = await leased(mark);
    const taskId = String((job.task as Json).id);
    const page = `https://shop-${mark}.example/login?next=/orders`;
    const noticed = await tool(runner, 'browser_login_needed', {
      task_id: taskId,
      page_url: page,
      page_title: '로그인',
      image: JPEG,
    });
    assert.equal(noticed.ok, true, JSON.stringify(noticed.body));
    assert.equal(noticed.body.site_name, `shop-${mark}.example`);
    const made = (ok(await api.get(`${BASE}/sites`, owner)).sites as Json[]).find(
      (s) => s.id === noticed.body.site_id,
    ) as Json;
    assert.deepEqual(
      [made.startUrl, made.origins, made.loginNeededAt !== null],
      [`https://shop-${mark}.example/`, [`https://shop-${mark}.example`], true],
    );
    // 같은 출처면 같은 사이트를 쓴다 (또 만들지 않는다)
    const again = await tool(runner, 'browser_login_needed', { task_id: taskId, page_url: page });
    assert.equal(again.body.site_id, noticed.body.site_id);

    const asked = await tool(String(job.run_token), 'request_approval', {
      request_id: `login-${taskId}`,
      action: 'browser.site.login',
      target_kind: 'browser_site',
      target_id: noticed.body.site_id,
      target_version: noticed.body.site_version,
      note: `로그인 필요: shop-${mark}.example`,
    });
    assert.equal(asked.ok, true, JSON.stringify(asked.body));
    await decide(
      ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner)),
      'revise',
      '로그인했어요',
    );
    assert.equal((await taskOf(taskId)).status, 'queued');
    const back = await leased(mark);
    assert.deepEqual(back.target, {
      kind: 'browser_site',
      id: noticed.body.site_id,
      version: noticed.body.site_version,
    });
    const plan = await tool(runner, 'browser_job', { task_id: taskId });
    assert.equal(plan.body.mode, 'site', '로그인된 브라우저의 사이트 일로 이어진다');
    assert.equal(plan.body.login_needed, false);
  });
});

describe('브라우저 에이전트: 결재된 클릭', () => {
  test('사이트 일: browser_job · 단계 화면 · 붙잡기 → 결재 → 그 러너만 가져가 누르면 작업이 끝난다', async () => {
    const site = await newSite();
    const { job, taskId, run } = await siteJob(site);
    assert.deepEqual(job.target, { kind: 'browser_site', id: site.id, version: site.version });
    assert.equal(
      ((job.task as Json).payload as Json).site,
      undefined,
      '사이트 값은 payload에 싣지 않는다',
    );

    assert.equal(
      (await tool(other, 'browser_job', { task_id: taskId })).ok,
      false,
      '쥐지 않은 러너',
    );
    const plan = await tool(runner, 'browser_job', { task_id: taskId });
    assert.deepEqual(plan.body, {
      mode: 'site',
      site: {
        id: site.id,
        version: site.version,
        name: SITE.name,
        start_url: SITE.startUrl,
        origins: SITE.origins,
      },
      login_needed: false,
      held: null,
      build: null,
      click_plan: null,
    });
    const step = await tool(runner, 'browser_shot_save', {
      task_id: taskId,
      url: SITE.startUrl,
      title: '편집기',
      image: JPEG,
    });
    assert.deepEqual(step.body, { id: step.body.id, seq: 1 });
    const png = await tool(runner, 'browser_shot_save', {
      task_id: taskId,
      image: Buffer.from('GIF89a').toString('base64'),
    });
    assert.equal(png.ok, false, 'JPEG · PNG만');

    const outside = await hold(taskId, { page_url: 'https://evil.example/write' });
    assert.equal(outside.ok, false);
    assert.match(JSON.stringify(outside.body), /허용 출처 밖/);
    const { clickId, approval } = await heldClick(taskId, run);
    assert.equal((await taskOf(taskId)).status, 'waiting');
    const card = await clickOf(clickId);
    assert.equal(card.status, 'held');
    assert.equal(card.beforeImage, JPEG);
    assert.deepEqual(card.box, { x: 10, y: 20, width: 80, height: 30 });
    assert.equal(card.siteName, SITE.name);

    assert.deepEqual((await tool(runner, 'browser_click_next')).body, { click: null }, '승인 전');
    await decide(approval, 'approve');
    assert.equal((await clickOf(clickId)).status, 'approved');
    // 같은 승인 이벤트가 한 번 더 와도 (일꾼이 처리 표시 전에 멈춘 뒤) 승인된 클릭을 실패로 돌리지 않는다
    await api.service(Database).sql`
      UPDATE platform.outbox SET processed_at = NULL
      WHERE topic = 'task.approval.granted' AND payload->>'approvalId' = ${String(approval.id)}`;
    await drain();
    assert.equal((await clickOf(clickId)).status, 'approved');
    assert.equal((await taskOf(taskId)).status, 'running', '결과를 기다린다');
    assert.deepEqual(
      (await tool(other, 'browser_click_next')).body,
      { click: null },
      '붙잡은 러너만',
    );
    const next = (await tool(runner, 'browser_click_next')).body.click as Json;
    assert.deepEqual(
      [next.id, next.task_id, next.role, next.name, next.nth, next.fingerprint, next.page_url],
      [clickId, taskId, 'button', '게시', 0, FINGERPRINT, 'https://blog.example/write?draft=1'],
    );
    const saved = await tool(runner, 'browser_click_save', {
      id: clickId,
      version: next.version,
      outcome: 'clicked',
      after_url: 'https://blog.example/posts/1',
      image: JPEG,
    });
    assert.deepEqual(saved.body, { id: clickId, status: 'clicked' });
    const again = await tool(runner, 'browser_click_save', {
      id: clickId,
      version: next.version,
      outcome: 'clicked',
    });
    assert.equal(again.ok, false, '한 번만');
    await drain();
    assert.equal((await taskOf(taskId)).status, 'done');
    const done = await clickOf(clickId);
    assert.deepEqual(
      [done.status, done.afterUrl, done.afterImage, done.afterKind],
      ['clicked', 'https://blog.example/posts/1', JPEG, 'after'],
    );
    const { shots } = ok(await api.get(`${BASE}/shots?taskId=${taskId}`, owner)) as {
      shots: Json[];
    };
    assert.deepEqual(
      shots.map((s) => [s.seq, s.kind]),
      [
        [1, 'step'],
        [2, 'before'],
        [3, 'after'],
      ],
    );
    const one = ok(await api.get(`${BASE}/shots/${shots[0]?.id}`, owner));
    assert.deepEqual([one.image, one.mime], [JPEG, 'image/jpeg']);
  });

  test('승인 뒤 페이지가 바뀌었으면 누르지 않고(changed) 작업은 실패, 관리자가 직접 한 것을 기록한다', async () => {
    const { taskId, run } = await siteJob(await newSite());
    const { clickId, approval } = await heldClick(taskId, run);
    await decide(approval, 'approve');
    const next = (await tool(runner, 'browser_click_next')).body.click as Json;
    await tool(runner, 'browser_click_save', {
      id: clickId,
      version: next.version,
      outcome: 'changed',
      reason: '버튼이 달라요',
      image: JPEG,
    });
    await drain();
    const task = await taskOf(taskId);
    assert.equal(task.status, 'failed');
    assert.match(
      String((task.result as Json).error),
      /페이지가 바뀌어 누르지 않았어요 \(버튼이 달라요\)\. 콘솔 화면에서 직접/,
    );
    const changed = await clickOf(clickId);
    assert.deepEqual([changed.status, changed.afterKind], ['changed', 'changed']);
    const stale = await api.request('POST', `${BASE}/clicks/${clickId}/manual`, owner, {
      version: 1,
      done: true,
    });
    assert.equal(stale.status, 409);
    const manual = ok(
      await api.request('POST', `${BASE}/clicks/${clickId}/manual`, owner, {
        version: changed.version,
        done: true,
      }),
    );
    assert.deepEqual([manual.status, manual.reason], ['manual', '콘솔 화면에서 직접 눌렀어요']);
  });

  test('승인된 클릭을 관리자가 직접 눌렀다고 기록하면 작업이 끝나고, 러너는 그 클릭을 가져가지 않는다', async () => {
    const { taskId, run } = await siteJob(await newSite());
    const { clickId, approval } = await heldClick(taskId, run);
    await decide(approval, 'approve');
    const click = await clickOf(clickId);
    ok(
      await api.request('POST', `${BASE}/clicks/${clickId}/manual`, owner, {
        version: click.version,
        done: true,
      }),
    );
    await drain();
    assert.equal((await taskOf(taskId)).status, 'done');
    assert.deepEqual((await tool(runner, 'browser_click_next')).body, { click: null });
  });

  test('클릭 결재에서 수정 요청이면 클릭을 닫고, 다시 빌린 일은 붙잡아 둔 페이지를 받는다', async () => {
    const { taskId, run } = await siteJob(await newSite());
    const { clickId, approval } = await heldClick(taskId, run);
    await decide(approval, 'revise', '제목을 바꿔 주세요');
    assert.equal((await clickOf(clickId)).status, 'dropped');
    const task = await taskOf(taskId);
    assert.equal(task.status, 'queued');
    const job = await leased(String(task.title));
    assert.deepEqual((job.target as Json).kind, 'browser_click');
    const plan = await tool(runner, 'browser_job', { task_id: taskId });
    assert.equal(plan.body.mode, 'site');
    assert.deepEqual(plan.body.held, {
      click_id: clickId,
      page_url: 'https://blog.example/write?draft=1',
      tab_id: 'A'.repeat(32),
    });
    const moved = await hold(taskId);
    assert.equal(moved.ok, true, '고친 뒤 다시 붙잡는다');
  });

  test('취소된 작업의 승인된 클릭은 누르지 않는다. 기다리는 클릭이 있는 사이트의 세션은 지우지 않는다 (409)', async () => {
    const site = await newSite();
    const { taskId, run } = await siteJob(site);
    const { clickId, approval } = await heldClick(taskId, run);
    const busy = await api.request('POST', `${BASE}/sites/${site.id}/clear-session`, owner, {});
    assert.equal(busy.status, 409, busy.text);
    await decide(approval, 'approve');
    ok(
      await api.request('POST', `/api/tasks/${taskId}/cancel`, owner, {
        version: (await taskOf(taskId)).version,
      }),
    );
    await drain();
    assert.equal((await clickOf(clickId)).status, 'dropped');
    assert.deepEqual((await tool(runner, 'browser_click_next')).body, { click: null });
  });
});

describe('누르기 계획: 일 하나에 승인 한 번 (F2, 2026-11-21)', () => {
  const press = (token: string, more: Json = {}) =>
    tool(token, 'browser_press', {
      page_url: 'https://blog.example/place/1',
      role: 'button',
      name: '저장',
      ...more,
    });

  test('계획 붙잡기 → 한 번 승인 → 같은 일이 다시 돌고, AI가 요청한 버튼을 러너가 누른다. 횟수 · 사이트는 서버가 지킨다', async () => {
    const site = await newSite();
    const { taskId, run } = await siteJob(site);
    const early = await press(run);
    assert.equal(early.ok, false);
    assert.match(JSON.stringify(early.body), /승인된 누르기 계획이 없어요/);
    const away = await tool(runner, 'browser_click_plan', {
      task_id: taskId,
      page_url: 'https://evil.example/x',
      summary: '저장',
      count: 2,
    });
    assert.equal(away.ok, false, '허용 출처 밖');
    const held = await tool(runner, 'browser_click_plan', {
      task_id: taskId,
      page_url: 'https://blog.example/place/1',
      summary: '목록에 2곳 저장',
      count: 2,
    });
    assert.equal(held.ok, true, JSON.stringify(held.body));
    const asked = await tool(run, 'request_approval', {
      request_id: `plan-${held.body.plan_id}`,
      action: 'browser.site.publish',
      target_kind: 'browser_click_plan',
      target_id: held.body.plan_id,
      target_version: held.body.version,
      note: '누르기 계획: 목록에 2곳 저장 (2번)',
    });
    assert.equal(asked.ok, true, JSON.stringify(asked.body));
    assert.equal((await taskOf(taskId)).status, 'waiting');
    await decide(ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner)), 'approve');
    const resumed = await taskOf(taskId);
    assert.equal(resumed.status, 'queued', '승인하면 같은 일이 다시 대기열로');

    const again = await leased(String(resumed.title));
    assert.equal((again.task as Json).id, taskId);
    const next = String(again.run_token);
    const job = await tool(runner, 'browser_job', { task_id: taskId });
    assert.deepEqual(job.body.click_plan, {
      id: held.body.plan_id,
      summary: '목록에 2곳 저장',
      max_clicks: 2,
      used: 0,
      left: 2,
    });
    const elsewhere = await press(next, { page_url: 'https://evil.example/place/1' });
    assert.match(JSON.stringify(elsewhere.body), /계획한 사이트/);

    const first = await press(next, { note: '1/2 저장' });
    assert.equal(first.ok, true, JSON.stringify(first.body));
    assert.deepEqual([first.body.status, first.body.left], ['requested', 2]);
    const busy = await press(next);
    assert.match(JSON.stringify(busy.body), /앞 누르기가 끝난 뒤에/);
    assert.equal(
      (await tool(other, 'browser_press_next', { task_id: taskId })).ok,
      false,
      '쥐지 않은 러너',
    );
    const one = (await tool(runner, 'browser_press_next', { task_id: taskId })).body.click as Json;
    assert.deepEqual(
      [one.id, one.role, one.name, one.nth, one.note],
      [first.body.click_id, 'button', '저장', 0, '1/2 저장'],
    );
    const clicked = await tool(runner, 'browser_press_save', {
      task_id: taskId,
      click_id: one.id,
      version: one.version,
      outcome: 'clicked',
      after_url: 'https://blog.example/place/1?saved=1',
      tab_id: 'A'.repeat(32),
      box: { x: 1, y: 2, width: 3, height: 4 },
      fingerprint: FINGERPRINT,
      before_image: JPEG,
      after_image: JPEG,
    });
    assert.equal(clicked.ok, true, JSON.stringify(clicked.body));
    const seen = await tool(next, 'browser_press_result', {
      click_id: first.body.click_id,
      wait_seconds: 0,
    });
    assert.deepEqual([seen.body.status, seen.body.left], ['clicked', 1]);
    const detail = await clickOf(String(first.body.click_id));
    assert.deepEqual(
      [detail.status, detail.beforeImage, detail.afterImage],
      ['clicked', JPEG, JPEG],
    );

    const second = await press(next, { page_url: 'https://blog.example/place/2' });
    const two = (await tool(runner, 'browser_press_next', { task_id: taskId })).body.click as Json;
    const missed = await tool(runner, 'browser_press_save', {
      task_id: taskId,
      click_id: two.id,
      version: two.version,
      outcome: 'changed',
      reason: '버튼이 없어요: button "저장"',
    });
    assert.equal(missed.ok, true, JSON.stringify(missed.body));
    const late = await tool(next, 'browser_press_result', { click_id: second.body.click_id });
    assert.deepEqual(
      [late.body.status, late.body.reason, late.body.left],
      ['changed', '버튼이 없어요: button "저장"', 0],
      '가져갈 때 세므로 누르지 못한 것도 센다',
    );
    const over = await press(next);
    assert.match(JSON.stringify(over.body), /계획한 2번을 다 눌렀어요/);

    const submitted = await tool(runner, 'submit_result', {
      task_id: taskId,
      request_id: randomUUID(),
      status: 'done',
      result: { summary: '1곳 저장, 1곳은 버튼이 없음' },
    });
    assert.equal(submitted.ok, true, JSON.stringify(submitted.body));
    await drain();
    const [row] = await api.service(Database).sql`
      SELECT status, used FROM browser_tabs.click_plans WHERE id = ${String(held.body.plan_id)}`;
    assert.deepEqual([row?.status, row?.used], ['closed', 2], '작업이 끝나면 계획을 닫는다');
  });

  test('계획 결재의 수정 요청 · 반려는 계획을 닫고, 다시 빌린 일은 계획 없이 돈다', async () => {
    const { taskId, run } = await siteJob(await newSite());
    const held = await tool(runner, 'browser_click_plan', {
      task_id: taskId,
      page_url: 'https://blog.example/write',
      summary: '글 3개 올리기',
      count: 3,
    });
    const asked = await tool(run, 'request_approval', {
      request_id: `plan-${held.body.plan_id}`,
      action: 'browser.site.publish',
      target_kind: 'browser_click_plan',
      target_id: held.body.plan_id,
      target_version: held.body.version,
      note: '누르기 계획',
    });
    await decide(
      ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner)),
      'revise',
      '두 개만',
    );
    const back = await taskOf(taskId);
    assert.equal(back.status, 'queued');
    await leased(String(back.title));
    const job = await tool(runner, 'browser_job', { task_id: taskId });
    assert.equal(job.ok, true, JSON.stringify(job.body));
    assert.equal(job.body.click_plan, null);
    assert.equal((job.body.site as Json).origins !== undefined, true, '계획의 사이트로 돈다');
    const [row] = await api.service(Database).sql`
      SELECT status FROM browser_tabs.click_plans WHERE id = ${String(held.body.plan_id)}`;
    assert.equal(row?.status, 'dropped');
  });
});

describe('브라우저 에이전트: 로그인 필요', () => {
  test('로그인 화면 → 사이트에 표시 · 화면 → 결재 → "로그인했어요"(수정 요청)면 표시를 비우고 같은 작업이 이어진다', async () => {
    const site = await newSite();
    const { taskId, run } = await siteJob(site);
    const noticed = await tool(runner, 'browser_login_needed', {
      task_id: taskId,
      page_url: 'https://accounts.example/login',
      page_title: '로그인',
      image: JPEG,
    });
    assert.deepEqual(noticed.body, {
      site_id: site.id,
      site_version: site.version,
      site_name: SITE.name,
      login_card: false,
    });
    const sites = (ok(await api.get(`${BASE}/sites`, owner)).sites as Json[]).find(
      (s) => s.id === site.id,
    ) as Json;
    assert.notEqual(sites.loginNeededAt, null);
    assert.equal(sites.version, site.version, '판은 올리지 않는다');
    const plan = await tool(runner, 'browser_job', { task_id: taskId });
    assert.equal(plan.body.login_needed, true);

    const asked = await tool(run, 'request_approval', {
      request_id: `login-${taskId}`,
      action: 'browser.site.login',
      target_kind: 'browser_site',
      target_id: site.id,
      target_version: site.version,
      note: '로그인 필요: 시험 블로그',
    });
    assert.equal(asked.ok, true, JSON.stringify(asked.body));
    const approval = ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner));
    await decide(approval, 'revise', '로그인했어요');
    const after = (ok(await api.get(`${BASE}/sites`, owner)).sites as Json[]).find(
      (s) => s.id === site.id,
    ) as Json;
    assert.equal(after.loginNeededAt, null);
    const task = await taskOf(taskId);
    assert.equal(task.status, 'queued', '위임 사슬을 끊지 않고 같은 작업이 이어진다');
    const { shots } = ok(await api.get(`${BASE}/shots?taskId=${taskId}`, owner)) as {
      shots: Json[];
    };
    assert.deepEqual(
      shots.map((s) => [s.kind, s.url]),
      [['login', 'https://accounts.example/login']],
    );
  });

  test('로그인 결재를 승인하면 쓰지 않는 길이라 실패로 끝난다. 반려하면 작업이 취소된다', async () => {
    const site = await newSite();
    for (const [decision, status] of [
      ['approve', 'failed'],
      ['reject', 'cancelled'],
    ] as const) {
      const { taskId, run } = await siteJob(site);
      const asked = await tool(run, 'request_approval', {
        request_id: `login-${taskId}`,
        action: 'browser.site.login',
        target_kind: 'browser_site',
        target_id: site.id,
        target_version: site.version,
      });
      await decide(ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner)), decision);
      const task = await taskOf(taskId);
      assert.equal(task.status, status, decision);
      if (decision === 'approve') assert.match(String((task.result as Json).error), /로그인했어요/);
    }
  });
});

/** 러너가 확인한 로그인 칸 (값 없음) */
const FORM = {
  fields: [
    { kind: 'id', role: 'textbox', name: '아이디' },
    { kind: 'password', role: 'textbox', name: '비밀번호' },
  ],
  submit: { role: 'button', name: '로그인' },
};
/** 테스트용 비밀번호 (카드 · DB · 실행 기록에 남지 않는지 본다) */
const PASSWORD = `pw-${randomUUID()}`;

describe('로그인 카드 (2026-11-19)', () => {
  const card = async (siteId: unknown) => ok(await api.get(`${BASE}/sites/${siteId}/login`, owner));

  test('믿는 출처(등록한 사이트)면 칸이 뜨고, 넣은 값은 그 화면을 연 러너가 한 번만 꺼내 간다. 결과는 카드가 본다', async () => {
    const site = await newSite();
    const { taskId } = await siteJob(site);
    const noticed = await tool(runner, 'browser_login_needed', {
      task_id: taskId,
      page_url: 'https://login.blog.example/signin',
      form: FORM,
    });
    assert.equal(noticed.body.login_card, true, '같은 도메인의 로그인 주소');
    const shown = await card(site.id);
    assert.deepEqual(
      [shown.origin, shown.fields, shown.trusted, shown.attempt],
      ['https://login.blog.example', [{ kind: 'id' }, { kind: 'password' }], true, null],
    );
    // 보는 사람별: 방문자 · write 기기는 카드를 읽지도 넣지도 못한다
    for (const headers of [{}, writer]) {
      const read = await api.request(
        'GET',
        `${BASE}/sites/${site.id}/login`,
        TestUser.visitor,
        undefined,
        headers,
      );
      assert.equal(read.status, 403, read.text);
      const values = { values: { id: 'x', password: 'y' } };
      const sent = await api.request(
        'POST',
        `${BASE}/sites/${site.id}/login`,
        TestUser.visitor,
        values,
        headers,
      );
      assert.equal(sent.status, 403, sent.text);
    }
    const missing = await api.request('POST', `${BASE}/sites/${site.id}/login`, owner, {
      values: { id: 'me' },
    });
    assert.equal(missing.status, 422, missing.text);
    assert.equal((await tool(runner, 'browser_login_next')).body.login, null, '넣기 전');

    const sent = ok(
      await api.request('POST', `${BASE}/sites/${site.id}/login`, owner, {
        values: { id: 'me', password: PASSWORD },
      }),
    );
    assert.equal((sent.attempt as Json).status, 'sent');
    assert.doesNotMatch(
      JSON.stringify(sent) + JSON.stringify(await card(site.id)),
      new RegExp(PASSWORD),
    );
    assert.equal(
      (await tool(other, 'browser_login_next')).body.login,
      null,
      '다른 러너는 못 꺼낸다',
    );
    const next = (await tool(runner, 'browser_login_next')).body.login as Json;
    assert.deepEqual(
      [next.site_id, next.page_url, (next.fields as Json[]).map((f) => [f.kind, f.name, f.value])],
      [
        site.id,
        'https://login.blog.example/signin',
        [
          ['id', '아이디', 'me'],
          ['password', '비밀번호', PASSWORD],
        ],
      ],
    );
    assert.deepEqual(next.submit, FORM.submit);
    assert.equal((await tool(runner, 'browser_login_next')).body.login, null, '한 번만');
    assert.equal(((await card(site.id)).attempt as Json).status, 'filling');

    const stranger = await tool(other, 'browser_login_save', {
      site_id: site.id,
      outcome: 'submitted',
    });
    assert.equal(stranger.ok, false, '꺼내 간 러너만 결과를 남긴다');
    const saved = await tool(runner, 'browser_login_save', {
      site_id: site.id,
      outcome: 'submitted',
      after_url: 'https://blog.example/write',
      image: JPEG,
    });
    assert.equal(saved.ok, true, JSON.stringify(saved.body));
    const done = (await card(site.id)).attempt as Json;
    assert.deepEqual(
      [done.status, done.afterUrl, done.image],
      ['submitted', 'https://blog.example/write', JPEG],
    );
    // 값은 DB 어디에도 남지 않는다 (사이트의 칸 · 실행 기록 · 결재)
    const db = api.service(Database);
    const [found] = await db.sql<{ n: number }[]>`
      SELECT (SELECT count(*) FROM browser_tabs.sites WHERE login_form::text LIKE ${`%${PASSWORD}%`})
        + (SELECT count(*) FROM task.task_events WHERE body LIKE ${`%${PASSWORD}%`})
        + (SELECT count(*) FROM task.approvals WHERE coalesce(note, '') LIKE ${`%${PASSWORD}%`}) AS n`;
    assert.equal(Number(found?.n), 0);
  });

  test('믿지 않는 출처면 칸이 뜨지 않는다: 다른 도메인 · 저절로 만든 사이트. 관리자의 지시에 그 도메인이 있거나 "로그인했어요" 뒤에는 뜬다', async () => {
    const site = await newSite();
    const { taskId } = await siteJob(site);
    const elsewhere = await tool(runner, 'browser_login_needed', {
      task_id: taskId,
      page_url: 'https://blog-example-login.example/signin',
      form: FORM,
    });
    assert.equal(elsewhere.body.login_card, false, '사이트와 다른 도메인');
    assert.equal((await card(site.id)).fields, null);
    const refused = await api.request('POST', `${BASE}/sites/${site.id}/login`, owner, {
      values: { id: 'me', password: PASSWORD },
    });
    assert.equal(refused.status, 422, refused.text);

    const explore = async (instruction: string) => {
      const mark = randomUUID().slice(0, 8);
      ok(
        await api.request('POST', `${BASE}/explore`, owner, {
          requestId: randomUUID(),
          instruction: `${instruction} ${mark}`,
          agentId,
        }),
      );
      await drain();
      return { job: await leased(mark), mark };
    };
    const host = `mall-${randomUUID().slice(0, 6)}.co.kr`;
    const quiet = await explore('주문 내역을 정리해 주세요');
    const page = `https://www.${host}/member/login`;
    const unknown = await tool(runner, 'browser_login_needed', {
      task_id: (quiet.job.task as Json).id,
      page_url: page,
      form: FORM,
    });
    assert.equal(unknown.body.login_card, false, '저절로 만든 사이트 · 지시에 없는 도메인');
    assert.equal((await card(unknown.body.site_id)).trusted, false);

    const named = await explore(`${host}에서 주문 내역을 정리해 주세요`);
    const mentioned = await tool(runner, 'browser_login_needed', {
      task_id: (named.job.task as Json).id,
      page_url: page,
      form: FORM,
    });
    assert.equal(mentioned.body.site_id, unknown.body.site_id);
    assert.equal(mentioned.body.login_card, true, '관리자의 지시에 적힌 도메인 (등록 단위)');

    // 화면에서 로그인하고 "로그인했어요" → 그 사이트를 믿는다
    const asked = await tool(String(quiet.job.run_token), 'request_approval', {
      request_id: `login-${(quiet.job.task as Json).id}`,
      action: 'browser.site.login',
      target_kind: 'browser_site',
      target_id: unknown.body.site_id,
      target_version: unknown.body.site_version,
    });
    await decide(
      ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner)),
      'revise',
      '로그인했어요',
    );
    await drain();
    assert.equal((await card(unknown.body.site_id)).trusted, true);
  });

  test('틀린 모양의 칸은 받지 않는다 (같은 종류 둘 · 모르는 종류)', async () => {
    const site = await newSite();
    const { taskId } = await siteJob(site);
    for (const form of [
      { ...FORM, fields: [FORM.fields[0], FORM.fields[0]] },
      { ...FORM, fields: [{ kind: 'card', role: 'textbox', name: '카드 번호' }] },
      { ...FORM, fields: [] },
    ]) {
      const res = await tool(runner, 'browser_login_needed', {
        task_id: taskId,
        page_url: 'https://blog.example/login',
        form,
      });
      assert.equal(res.ok, false, JSON.stringify(form));
    }
  });
});

describe('API 기록 → API 사이트 도구 (B2 · B3, 2026-11-19)', () => {
  const call = (method: string, origin: string, path: string, response?: object) => ({
    method,
    origin,
    path,
    query: ['page'],
    status: 200,
    content_type: 'application/json',
    ...(response ? { response: JSON.stringify(response) } : {}),
  });

  test('사이트 일의 요청 모양을 남기고(허용 출처만), 처음 읽을 만한 API가 생기면 API 도구를 한 번 굳히기 시작한다', async () => {
    const site = await newSite();
    const { taskId } = await siteJob(site);
    const saved = await tool(runner, 'browser_requests_save', {
      task_id: taskId,
      requests: [
        call('GET', 'https://blog.example', '/api/posts', {
          items: [{ id: 'number', title: 'string' }],
        }),
        call('POST', 'https://blog.example', '/api/posts/{n}/like'),
        call('GET', 'https://tracker.example', '/collect', { ok: 'boolean' }),
      ],
    });
    assert.equal(saved.ok, true, JSON.stringify(saved.body));
    assert.deepEqual(saved.body, { saved: 2, building: true });
    const db = api.service(Database);
    const rows = await db.sql<{ method: string; path: string; seen: number }[]>`
      SELECT method, path, seen FROM browser_tabs.endpoints WHERE site_id = ${String(site.id)} ORDER BY method`;
    assert.deepEqual(
      rows.map((r) => [r.method, r.path, r.seen]),
      [
        ['GET', '/api/posts', 1],
        ['POST', '/api/posts/{n}/like', 1],
      ],
    );
    const { integrations } = ok(await api.get(`${BASE}/integrations`, owner)) as {
      integrations: Json[];
    };
    const made = integrations.find((i) => i.siteId === site.id) as Json;
    assert.deepEqual([made.name, made.status, made.mode], ['api_blog_example', 'building', 'read']);

    // 같은 사이트의 다음 일: 횟수만 오르고 다시 만들지 않는다
    const next = await siteJob(site);
    const again = await tool(runner, 'browser_requests_save', {
      task_id: next.taskId,
      requests: [call('GET', 'https://blog.example', '/api/posts', { items: [] })],
    });
    assert.deepEqual(again.body, { saved: 1, building: false });

    // 굳히는 일은 그 기록을 받는다 (화면 대신 site.api로 부를 재료). 다음 일을 빌릴 때 러너가 함께 빌렸다
    const [build] = await db.sql<{ id: string }[]>`
      SELECT id FROM task.tasks WHERE request_id = ${`browser-tabs:integration:api:${site.id}`}`;
    assert.ok(build, '굳히기 작업이 생긴다');
    const plan = await tool(runner, 'browser_job', { task_id: build.id });
    const endpoints = (plan.body.build as Json).endpoints as Json[];
    assert.equal(endpoints[0]?.url, 'https://blog.example/api/posts');
    assert.equal(endpoints[0]?.seen, 2);
    assert.deepEqual(endpoints[0]?.response, { items: [] });
  });

  test('둘러보기 · 쥐지 않은 러너는 남기지 못하고, JSON이 아닌 모양은 받지 않는다', async () => {
    const mark = randomUUID().slice(0, 8);
    ok(
      await api.request('POST', `${BASE}/explore`, owner, {
        requestId: randomUUID(),
        instruction: `가격 비교 ${mark}`,
        agentId,
      }),
    );
    await drain();
    const job = await leased(mark);
    const explore = await tool(runner, 'browser_requests_save', {
      task_id: (job.task as Json).id,
      requests: [call('GET', 'https://blog.example', '/api/x')],
    });
    assert.equal(explore.ok, false);
    assert.match(JSON.stringify(explore.body), /둘러보기에서는 기록하지 않아요/);

    const site = await newSite();
    const { taskId } = await siteJob(site);
    const stranger = await tool(other, 'browser_requests_save', { task_id: taskId, requests: [] });
    assert.equal(stranger.ok, false, '임대를 쥔 러너만');
    const broken = await tool(runner, 'browser_requests_save', {
      task_id: taskId,
      requests: [{ ...call('GET', 'https://blog.example', '/api/x'), response: '{not json' }],
    });
    assert.equal(broken.ok, false);
  });
});

describe('브라우저 일의 위임', () => {
  /** 대표 (O-2). 없으면 첫 대화를 열어 만든다 */
  async function leadId(): Promise<string> {
    const found = ok(await api.get('/api/agents/lead', owner)).lead as Json | null;
    if (found) return String(found.id);
    ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '대표를 만드는 첫 대화',
      }),
      201,
    );
    return String((ok(await api.get('/api/agents/lead', owner)).lead as Json).id);
  }
  /** 맡기는 쪽(agent)의 일을 러너가 빌린 작업 토큰, 맡을 일꾼, 사이트 */
  async function jobOf(agent: string): Promise<{ run: string; member: string; site: Json }> {
    const member = await newAgent('브라우저 일꾼');
    const mark = randomUUID().slice(0, 8);
    ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: agent,
        title: `조사 ${mark}`,
        instruction: '가입 양식을 채워 주세요',
      }),
      201,
    );
    const job = await leased(mark);
    return { run: String(job.run_token), member, site: await newSite() };
  }
  const subtask = (member: string, site: Json | null) => ({
    request_id: randomUUID(),
    to_agent_id: member,
    kind: 'browse',
    title: site ? '양식 채우기' : '둘러보기',
    instruction: '이름 칸에 홍길동',
    ...(site
      ? { target_kind: 'browser_site', target_id: site.id, target_version: site.version }
      : {}),
  });

  test('대표는 비공개를 읽어도 일꾼에게 사이트 일 · 둘러보기를 맡긴다 (2026-11-21). 사이트는 browser_sites로 고른다', async () => {
    const { run, member, site } = await jobOf(await leadId());
    const sites = await tool(run, 'browser_sites');
    assert.ok(
      (sites.body.sites as Json[]).some((s) => s.id === site.id && s.start_url === SITE.startUrl),
    );
    const done = await tool(run, 'delegate_task', {
      subtasks: [subtask(member, site), subtask(member, null)],
    });
    assert.equal(done.ok, true, JSON.stringify(done.body));
    const [siteJob, explore] = (await Promise.all(
      (done.body.subtasks as Json[]).map((s) => taskOf(String(s.task_id))),
    )) as [Json, Json];
    const target = siteJob.target as Json;
    assert.deepEqual([siteJob.kind, target.kind, target.id], ['browse', 'browser_site', site.id]);
    assert.deepEqual([explore.kind, explore.target], ['browse', null], '대상 없으면 둘러보기');
  });

  test('일꾼은 브라우저 일을 맡기지 못한다: 맡기기는 대표만 (forbidden)', async () => {
    const { run, member, site } = await jobOf(await newAgent('맡기려는 일꾼'));
    const refused = await tool(run, 'delegate_task', { subtasks: [subtask(member, site)] });
    assert.equal(refused.ok, false, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'forbidden');
    assert.match(String(refused.body.message), /대표만 일꾼에게 맡길 수 있어요/);
  });
});
