import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ServerRunnerPolicy } from '../modules/account';
import { Database, OutboxWorker } from '../modules/platform';
import { ApiClient, TestUser } from './api-client';

// 페이지 (/api/pages, 바깥 주소 /pages/… → api/pages/site/…). 만들기 작업이 끝나면 결과물 묶음이 판이 되어 곧바로 보인다.
// task(만들기 작업) → 이벤트 → blog(페이지)를 잇는 흐름이라 모듈 밖에 둔다.
// 보는 사람별: 방문자 · write 기기 · 주인. 비공개 페이지는 방문자에게 없는 페이지와 같고, 주인은 보기 표가 든 주소로 본다.

type Json = Record<string, unknown>;
type Page = {
  id: string;
  name: string;
  title: string;
  visibility: string;
  currentSeq: number;
  revisions: number;
  version: number;
};

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
let worker: OutboxWorker;
let dir: string;
let slot: string;
let maker: Json;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function mcp(token: string, name: string, args: Json): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.ok(result && !result.isError, res.text);
  return result.structuredContent ?? {};
}

/** 칸 러너가 이 작업을 빌린다 */
async function lease(taskId: string): Promise<void> {
  for (let round = 0; round < 20; round++) {
    const { jobs } = (await mcp(slot, 'next_jobs', {
      wait_seconds: 0,
      limit: 10,
      tools: ['claude'],
    })) as { jobs: Json[] };
    if (jobs.some((j) => (j.task as Json).id === taskId)) return;
    if (jobs.length === 0) break;
  }
  assert.fail('작업을 빌리지 못했어요');
}

/**
 * 만들기 작업 하나를 처음부터 끝까지: 맡기기 → 칸 러너가 빌려 파일을 올리고 → 끝내기 → 일꾼이 이벤트를 넘긴다.
 * 끝난 작업의 상태를 돌려준다
 */
async function build(
  page: Json,
  files: Readonly<Record<string, string>>,
  instruction = `페이지 만들기 ${randomUUID()}`,
  /** 빌린 뒤 올리기 전에 (러너가 page_base를 읽는 때) */
  leased: (taskId: string) => Promise<void> = async () => {},
): Promise<string> {
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      kind: 'make',
      agentId: maker.id,
      instruction,
      page,
    }),
    201,
  );
  await lease(String(task.id));
  await leased(String(task.id));
  for (const [name, text] of Object.entries(files)) {
    const bytes = Buffer.from(text);
    const ticket = await mcp(slot, 'begin_upload', {
      task_id: task.id,
      name,
      size: bytes.length,
      sha256: sha(bytes),
    });
    const res = await fetch(`${api.baseUrl}${ticket.upload_path}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-moida-upload': String(ticket.token),
      },
      body: bytes,
    });
    assert.equal(res.status, 200, await res.clone().text());
  }
  const done = await mcp(slot, 'submit_result', {
    task_id: task.id,
    request_id: randomUUID(),
    status: 'done',
    result: { text: '만들었어요' },
  });
  await worker.tick();
  return String(done.status);
}

const pages = async (as: TestUser = owner, headers: Record<string, string> = {}) =>
  ok(await api.request('GET', '/api/pages', as, undefined, headers)).pages as Page[];
const pageOf = async (title: string) => (await pages()).find((p) => p.title === title) as Page;
/** 바깥 주소 하나. 다른 주소로 보내면 따라가지 않고 그 답을 그대로 본다 */
const site = (path: string, as: TestUser = TestUser.visitor) =>
  fetch(`${api.baseUrl}/api/pages/site/${path}`, {
    redirect: 'manual',
    headers:
      as === TestUser.visitor ? {} : { cookie: `moida_session=${owner.cookies.moida_session}` },
  });
/** 바깥 주소의 Location(/pages/…)을 서버 경로(api/pages/site/…)로 */
const follow = (location: string | null) => String(location).replace(/^\/pages\//, '');

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moida-page-test-'));
  process.env.MOIDA_BLOBS_DIR = dir;
  process.env.MOIDA_DISK_RESERVE_GB = '0';
  api = await ApiClient.start();
  owner = await api.signIn();
  worker = api.service(OutboxWorker);
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'page-writer')}` };
  const space = ok(await api.get('/api/space'));
  ok(
    await api.request('PUT', '/api/space', owner, {
      name: space.name || '페이지',
      siteUrl: api.baseUrl,
      version: space.version,
    }),
  );
  const secret = api.service(ServerRunnerPolicy).codeSecret();
  slot = String(
    ok(await api.request('POST', '/api/devices/code-runner', owner, { secret, slot: '7' })).token,
  );
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  maker = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `페이지 담당 ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['make'],
    }),
    201,
  );
  // 앞 시험 파일이 남긴 이벤트를 먼저 비운다
  while ((await worker.tick()) > 0);
});

after(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});

describe('페이지 (/api/pages)', () => {
  test('만들기 작업이 끝나면 페이지가 생기고 그 판이 바로 보인다. 기본은 주인만', async () => {
    const title = `서울 데이트 코스 ${randomUUID().slice(0, 6)}`;
    const status = await build(
      { title },
      {
        'index.html': '<h1>코스</h1><link rel="stylesheet" href="style.css">',
        'style.css': 'h1{color:red}',
      },
      '이번 주 서울 데이트 코스 짜 줘',
    );
    assert.equal(status, 'done');
    const page = await pageOf(title);
    assert.deepEqual(
      [page.visibility, page.currentSeq, page.revisions],
      ['private', 1, 1],
      JSON.stringify(page),
    );
    assert.match(page.name, /^서울-데이트-코스-/);
    const detail = ok(await api.get(`/api/pages/${page.id}`, owner));
    const [revision] = detail.revisionList as { note: string; taskId: string; files: Json[] }[];
    assert.equal(revision?.note, '이번 주 서울 데이트 코스 짜 줘');
    // 화면이 방금 맡긴 작업의 페이지를 찾는 길: 목록의 lastTaskId와 작업의 page
    assert.equal((page as Page & { lastTaskId: string }).lastTaskId, revision?.taskId);
    const task = ok(await api.get(`/api/tasks/${revision?.taskId}`, owner));
    assert.deepEqual(task.page, { pageId: null });
    assert.deepEqual(
      (revision?.files ?? []).map((f) => f.name),
      ['index.html', 'style.css'],
    );
  });

  test('방문자와 write 기기는 비공개 페이지를 보지 못하고 고치지 못한다', async () => {
    const title = `비공개 ${randomUUID().slice(0, 6)}`;
    await build({ title }, { 'index.html': '<p>비밀</p>' });
    const page = await pageOf(title);
    for (const headers of [{}, writer]) {
      assert.ok(!(await pages(TestUser.visitor, headers)).some((p) => p.name === page.name));
      const detail = await api.request(
        'GET',
        `/api/pages/${page.id}`,
        TestUser.visitor,
        undefined,
        headers,
      );
      assert.equal(detail.status, 403, detail.text);
      const edit = await api.request(
        'PATCH',
        `/api/pages/${page.id}`,
        TestUser.visitor,
        { version: page.version, visibility: 'public' },
        headers,
      );
      assert.equal(edit.status, 403, edit.text);
      const move = await api.request(
        'POST',
        `/api/pages/${page.id}/current`,
        TestUser.visitor,
        { version: page.version, seq: 1 },
        headers,
      );
      assert.equal(move.status, 403, move.text);
    }
    const name = encodeURIComponent(page.name);
    assert.equal((await site(`${name}/index.html`)).status, 404, '방문자에게는 없는 페이지');
    assert.equal((await site(name)).status, 404);
    assert.equal((await site('no-such-page/index.html')).status, 404);
  });

  test('주인은 비공개 페이지를 보기 표가 든 주소로 본다. 응답은 격리해서 열린다', async () => {
    const title = `주인만 ${randomUUID().slice(0, 6)}`;
    await build({ title }, { 'index.html': '<p>나만</p>', 'app.js': 'console.log(1)' });
    const page = await pageOf(title);
    const name = encodeURIComponent(page.name);
    const first = await site(name, owner);
    assert.equal(first.status, 302);
    const location = first.headers.get('location');
    assert.match(String(location), new RegExp(`^/pages/~[^/]+/${name}/index\\.html$`));
    // 표가 든 주소는 쿠키 없이 열린다 (격리된 페이지 안에서는 쿠키가 실리지 않는다)
    const html = await site(follow(location));
    assert.equal(html.status, 200);
    assert.equal(await html.text(), '<p>나만</p>');
    assert.match(String(html.headers.get('content-type')), /^text\/html; charset=utf-8/);
    assert.match(
      String(html.headers.get('content-security-policy')),
      /^sandbox allow-scripts.*; frame-ancestors 'self'$/,
    );
    assert.doesNotMatch(String(html.headers.get('content-security-policy')), /allow-same-origin/);
    assert.equal(html.headers.get('cache-control'), 'private, no-store');
    assert.equal(html.headers.get('referrer-policy'), 'no-referrer');
    const script = await site(follow(location).replace('index.html', 'app.js'));
    assert.match(String(script.headers.get('content-type')), /^text\/javascript/);
    // 표가 틀리거나 다른 페이지의 표면 없는 페이지
    assert.equal((await site(`~wrong/${name}/index.html`)).status, 404);
    const other = await pageOf(title);
    assert.equal(other.id, page.id);
    assert.equal((await site(follow(location).replace('index.html', 'none.css'))).status, 404);
  });

  test('공개하면 누구나 보고, 내리면 다시 없는 페이지다. 낡은 version은 409', async () => {
    const title = `공개 ${randomUUID().slice(0, 6)}`;
    await build({ title }, { 'index.html': '<p>모두</p>' });
    const page = await pageOf(title);
    const name = encodeURIComponent(page.name);
    const shown = ok(
      await api.request('PATCH', `/api/pages/${page.id}`, owner, {
        version: page.version,
        visibility: 'public',
      }),
    );
    assert.equal(shown.visibility, 'public');
    assert.ok((await pages(TestUser.visitor)).some((p) => p.name === page.name));
    const entry = await site(name);
    assert.equal(entry.status, 302);
    assert.equal(entry.headers.get('location'), `/pages/${name}/index.html`);
    const html = await site(`${name}/index.html`);
    assert.equal(html.status, 200);
    assert.equal(await html.text(), '<p>모두</p>');
    assert.equal(html.headers.get('cache-control'), 'public, max-age=60');
    assert.match(String(html.headers.get('content-security-policy')), /^sandbox /);

    const stale = await api.request('PATCH', `/api/pages/${page.id}`, owner, {
      version: page.version,
      visibility: 'private',
    });
    assert.equal(stale.status, 409, stale.text);
    const wrong = await api.request('PATCH', `/api/pages/${page.id}`, owner, {
      version: shown.version,
      visibility: 'everyone',
    });
    assert.equal(wrong.status, 422, wrong.text);
    ok(
      await api.request('PATCH', `/api/pages/${page.id}`, owner, {
        version: shown.version,
        visibility: 'private',
        title: `${title} 내림`,
      }),
    );
    assert.equal((await site(`${name}/index.html`)).status, 404);
  });

  test('고쳐 달라는 같은 페이지에 새 판을 쌓고 바로 보인다. 앞 판으로 되돌릴 수 있다', async () => {
    const title = `판 ${randomUUID().slice(0, 6)}`;
    await build({ title }, { 'index.html': '<p>1판</p>' });
    const first = await pageOf(title);
    await build({ pageId: first.id }, { 'index.html': '<p>2판</p>' }, '성수로 바꿔 줘');
    const second = await pageOf(title);
    assert.deepEqual([second.id, second.currentSeq, second.revisions], [first.id, 2, 2]);
    ok(
      await api.request('PATCH', `/api/pages/${second.id}`, owner, {
        version: second.version,
        visibility: 'public',
      }),
    );
    const name = encodeURIComponent(second.name);
    assert.equal(await (await site(`${name}/index.html`)).text(), '<p>2판</p>');

    const now = await pageOf(title);
    const back = ok(
      await api.request('POST', `/api/pages/${now.id}/current`, owner, {
        version: now.version,
        seq: 1,
      }),
    );
    assert.equal(back.currentSeq, 1);
    assert.equal(await (await site(`${name}/index.html`)).text(), '<p>1판</p>');
    const none = await api.request('POST', `/api/pages/${now.id}/current`, owner, {
      version: back.version,
      seq: 9,
    });
    assert.equal(none.status, 404, none.text);
  });

  test('index.html이 없으면 작업이 실패로 끝나고 페이지는 생기지 않는다', async () => {
    const title = `문 없음 ${randomUUID().slice(0, 6)}`;
    const status = await build({ title }, { 'main.html': '<p>문이 아니다</p>' });
    assert.equal(status, 'failed');
    assert.equal(await pageOf(title), undefined);
  });

  test('같은 이벤트를 두 번 받아도 판은 하나다. 페이지 주문은 만들기 일에만 적는다', async () => {
    const title = `한 번 ${randomUUID().slice(0, 6)}`;
    await build({ title }, { 'index.html': '<p>한 번</p>' });
    const page = await pageOf(title);
    await api.service(Database).sql`
      UPDATE platform.outbox SET processed_at = NULL
      WHERE topic = 'task.page.built' AND payload->>'title' = ${title}`;
    await worker.tick();
    assert.equal((await pageOf(title)).revisions, page.revisions);
    const general = await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: maker.id,
      instruction: '페이지가 아닌 일',
      page: { title: '안 됨' },
    });
    assert.equal(general.status, 422, general.text);
  });
});

describe('자라는 페이지 (2차 5단계)', () => {
  test('러너는 쥔 일의 페이지 지금 판을 받고(page_base), 바뀐 파일만 내면 그 위에 새 판이 된다', async () => {
    const title = `현황판 ${randomUUID().slice(0, 6)}`;
    await build(
      { title },
      {
        'index.html': '<p>1판</p>',
        'data.json': JSON.stringify({ count: 1, list: [1, 2], gone: 'x' }),
        'logo.png': 'PNG',
      },
    );
    const first = await pageOf(title);
    const directed = ok(
      await api.request('PATCH', `/api/pages/${first.id}`, owner, {
        version: first.version,
        direction: '매주 숫자를 새로 채워요',
      }),
    );
    assert.equal(directed.direction, '매주 숫자를 새로 채워요');

    let base: Json = {};
    await build(
      { pageId: first.id },
      { 'data.json': JSON.stringify({ count: 2, list: [1, 2, 3] }) },
      '이번 주 숫자로',
      async (taskId) => {
        base = await mcp(slot, 'page_base', { task_id: taskId });
        const other = await api.mcp(String(writer.authorization).slice(7), 'tools/call', {
          name: 'page_base',
          arguments: { task_id: taskId },
        });
        assert.equal((other.json().result as Json).isError, true, '러너가 아닌 기기는 받지 못한다');
      },
    );
    assert.deepEqual(
      [base.page_id, base.title, base.direction, base.seq],
      [first.id, title, '매주 숫자를 새로 채워요', 1],
    );
    assert.deepEqual(
      (base.files as Json[]).map((f) => [f.name, f.text === null ? null : 'text']).sort(),
      [
        ['data.json', 'text'],
        ['index.html', 'text'],
        ['logo.png', null],
      ],
      '글 파일만 내용까지',
    );

    const second = await pageOf(title);
    assert.deepEqual([second.currentSeq, second.revisions], [2, 2], '비공개 페이지는 바로 보인다');
    const detail = ok(await api.get(`/api/pages/${second.id}`, owner));
    const [newest] = detail.revisionList as { seq: number; files: Json[] }[];
    assert.deepEqual(
      newest?.files.map((f) => f.name).sort(),
      ['data.json', 'index.html', 'logo.png'],
      '내지 않은 파일은 앞 판 그대로',
    );
    const changes = ok(await api.get(`/api/pages/${second.id}/revisions/2/changes`, owner));
    assert.deepEqual([changes.base, changes.data, changes.truncated], [1, true, false]);
    assert.deepEqual(
      (changes.changes as Json[]).map((c) => [c.path, c.kind, c.before, c.after]),
      [
        ['count', 'changed', '1', '2'],
        ['list[2]', 'added', null, '3'],
        ['gone', 'removed', '"x"', null],
      ],
    );
    const visitor = await api.get(`/api/pages/${second.id}/revisions/2/changes`);
    assert.equal(visitor.status, 403, visitor.text);
  });

  test('한 페이지를 고치는 일은 한 번에 하나 (409)', async () => {
    const title = `하나씩 ${randomUUID().slice(0, 6)}`;
    await build({ title }, { 'index.html': '<p>1판</p>' });
    const page = await pageOf(title);
    const ask = () =>
      api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        kind: 'make',
        agentId: maker.id,
        instruction: '고쳐 줘',
        page: { pageId: page.id },
      });
    const open = ok(await ask(), 201);
    const second = await ask();
    assert.equal(second.status, 409, second.text);
    assert.match(second.text, /이 페이지를 고치는 일이 이미 돌고 있어요/);
    ok(await api.request('POST', `/api/tasks/${open.id}/cancel`, owner, { version: open.version }));
    ok(await ask(), 201);
    const [left] = await api.service(Database).sql<{ id: string; version: number }[]>`
      SELECT id, version FROM task.tasks
      WHERE payload->'page'->>'pageId' = ${page.id} AND status = 'queued'`;
    ok(
      await api.request('POST', `/api/tasks/${left?.id}/cancel`, owner, { version: left?.version }),
    );
  });

  test('공개 페이지의 새 버전은 확인 대기: 알림이 오고, 관리자가 미리 본 뒤 "이 버전 보이기"로 바꾼다', async () => {
    const title = `공개 현황판 ${randomUUID().slice(0, 6)}`;
    await build({ title }, { 'index.html': '<p>1판</p>' });
    const first = await pageOf(title);
    ok(
      await api.request('PATCH', `/api/pages/${first.id}`, owner, {
        version: first.version,
        visibility: 'public',
      }),
    );
    await build({ pageId: first.id }, { 'index.html': '<p>2판</p>' }, '새 숫자로');
    const held = (await pageOf(title)) as Page & { pendingSeq: number | null };
    assert.deepEqual([held.currentSeq, held.revisions, held.pendingSeq], [1, 2, 2]);
    const name = encodeURIComponent(held.name);
    assert.equal(await (await site(`${name}/index.html`)).text(), '<p>1판</p>', '방문자는 앞 판');

    const detail = ok(await api.get(`/api/pages/${held.id}`, owner));
    const preview = await site(follow(String(detail.pendingPath)));
    assert.equal(await preview.text(), '<p>2판</p>', '관리자는 대기 판을 미리 본다');
    const notices = async () =>
      (ok(await api.get('/api/notifications', owner)).notifications as Json[]).filter(
        (n) => n.kind === 'blog.page.pending' && n.link === `/admin/library/pages/${held.id}`,
      );
    const [notice] = await notices();
    assert.deepEqual([notice?.severity, notice?.read], ['immediate', false]);

    const shown = ok(
      await api.request('POST', `/api/pages/${held.id}/current`, owner, {
        version: held.version,
        seq: 2,
      }),
    );
    assert.deepEqual([shown.currentSeq, shown.pendingSeq], [2, null]);
    assert.equal(await (await site(`${name}/index.html`)).text(), '<p>2판</p>');
    const [settled] = await notices();
    assert.equal(settled?.read, true, '보이면 알림은 읽음');
  });

  test('방향은 관리자만, 4000자까지, 빈 글이면 지운다', async () => {
    const title = `방향 ${randomUUID().slice(0, 6)}`;
    await build({ title }, { 'index.html': '<p>1판</p>' });
    const page = await pageOf(title);
    const long = await api.request('PATCH', `/api/pages/${page.id}`, owner, {
      version: page.version,
      direction: '가'.repeat(4001),
    });
    assert.equal(long.status, 400, long.text);
    const set = ok(
      await api.request('PATCH', `/api/pages/${page.id}`, owner, {
        version: page.version,
        direction: '여행 일정',
      }),
    );
    const kept = ok(
      await api.request('PATCH', `/api/pages/${page.id}`, owner, {
        version: set.version,
        title: `${title} 새 이름`,
      }),
    );
    assert.equal(kept.direction, '여행 일정', '보내지 않으면 그대로');
    const cleared = ok(
      await api.request('PATCH', `/api/pages/${page.id}`, owner, {
        version: kept.version,
        direction: '',
      }),
    );
    assert.equal(cleared.direction, '');
    const denied = await api.request(
      'PATCH',
      `/api/pages/${page.id}`,
      TestUser.visitor,
      { version: cleared.version, direction: '몰래' },
      writer,
    );
    assert.equal(denied.status, 403, denied.text);
  });
});
