import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ServerRunnerPolicy } from '../modules/account';
import { Database, OutboxWorker, ZipFile, ZipReader } from '../modules/platform';
import { ApiClient, ApiResult, TestUser } from './api-client';

// 앱 코드 (스토어 1-6, docs/스토어.md 9장): 앱마다 자기 코드 묶음을 버전으로 쌓고, 방문자 화면은 그 코드의 템플릿과 데이터로 그린다.
// task(만들기 작업) → 이벤트 → blog(앱 코드 버전)를 잇는 흐름이 있어 모듈 밖에 둔다.
// 보는 사람별: 방문자 · write 기기 · 관리자. 비공개 앱은 방문자에게 없는 앱과 같고, 관리자는 미리 보기 토큰 주소로 본다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
let worker: OutboxWorker;
let dir: string;
let slot: string;
let maker: Json;
/** 칸이 아닌 러너 (대화의 회차 같은 general 일) */
let runner: string;
const mark = randomUUID().slice(0, 6);

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

async function newApp(slug: string, kind = 'blog'): Promise<Json> {
  return ok(
    await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind,
      name: `앱 ${slug}`,
      slug,
    }),
    201,
  );
}

const appOf = async (id: unknown) =>
  (ok(await api.get('/api/apps', owner)).apps as Json[]).find((a) => a.id === id) as Json;

async function publish(app: Json): Promise<Json> {
  const now = await appOf(app.id);
  return ok(
    await api.request('PATCH', `/api/apps/${app.id}`, owner, {
      version: now.version,
      visibility: 'public',
    }),
  );
}

/** 앱에 든 공개 글 하나 */
async function publicPost(appId: unknown, title: string): Promise<Json> {
  const post = ok(
    await api.request('POST', '/api/posts', owner, {
      requestId: randomUUID(),
      title,
      body: `${title}의 본문`,
      appId,
    }),
    201,
  );
  return ok(
    await api.request('POST', `/api/posts/${post.id}/status`, owner, {
      version: post.version,
      status: 'published',
    }),
  );
}

/** 앱 화면 하나 (웹의 /<앱>/<path>가 부르는 것) */
const screen = (
  slug: string,
  path = '',
  more: Record<string, string> = {},
  as = TestUser.visitor,
) =>
  api.get(`/api/apps/site/${slug}/screen?${new URLSearchParams({ path, ...more }).toString()}`, as);

const zipOf = (files: Readonly<Record<string, string>>): Buffer => {
  const zip = new ZipFile();
  for (const [name, text] of Object.entries(files)) zip.add(name, text);
  return zip.toBuffer();
};

/** zip 올리기: 본문이 zip 파일 그대로라 fetch로 직접 보낸다 */
async function upload(
  app: Json,
  body: Buffer,
  as: TestUser | Readonly<Record<string, string>> = owner,
  type = 'application/zip',
): Promise<ApiResult> {
  const version = (await appOf(app.id)).version;
  const auth = as instanceof TestUser ? (as.header ? { cookie: as.header } : {}) : as;
  const res = await fetch(
    `${api.baseUrl}/api/apps/${app.id}/code/versions?version=${version}&note=zip`,
    { method: 'POST', headers: { 'content-type': type, ...auth }, body },
  );
  return new ApiResult(res.status, await res.text(), res.headers);
}

const code = async (app: Json) => ok(await api.get(`/api/apps/${app.id}/code`, owner));

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

/** 빌린 만들기 일이 바꾼 파일을 올리고 끝낸다 (러너가 하는 것: begin_upload → PUT → submit_result) */
async function deliver(
  taskId: string,
  files: Readonly<Record<string, string | Buffer>>,
): Promise<void> {
  for (const [name, text] of Object.entries(files)) {
    const bytes = Buffer.from(text);
    const ticket = await mcp(slot, 'begin_upload', {
      task_id: taskId,
      name,
      size: bytes.length,
      sha256: sha(bytes),
    });
    const res = await fetch(`${api.baseUrl}${ticket.upload_path}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'x-cairn-upload': String(ticket.token),
      },
      body: bytes,
    });
    assert.equal(res.status, 200, await res.clone().text());
  }
  await mcp(slot, 'submit_result', {
    task_id: taskId,
    request_id: randomUUID(),
    status: 'done',
    result: { text: '고쳤어요' },
  });
  while ((await worker.tick()) > 0);
}

/** 앱 코드를 고치는 만들기 작업 하나: 맡기기 → 빌리기 → app_code_base → 바꾼 파일 올리기 → 끝내기 → 일꾼 */
async function build(
  app: Json,
  files: Readonly<Record<string, string | Buffer>>,
): Promise<{ taskId: string; base: Json }> {
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      kind: 'make',
      agentId: maker.id,
      instruction: `앱 코드 고치기 ${randomUUID()}`,
      appCode: { appId: app.id },
    }),
    201,
  );
  await lease(String(task.id));
  const base = await mcp(slot, 'app_code_base', { task_id: task.id });
  await deliver(String(task.id), files);
  return { taskId: String(task.id), base };
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cairn-app-code-test-'));
  process.env.CAIRN_BLOBS_DIR = dir;
  process.env.CAIRN_DISK_RESERVE_GB = '0';
  api = await ApiClient.start();
  owner = await api.signIn();
  worker = api.service(OutboxWorker);
  writer = { authorization: `Bearer ${await api.writeDevice(owner, `app-code-${mark}`)}` };
  const secret = api.service(ServerRunnerPolicy).codeSecret();
  slot = String(
    ok(await api.request('POST', '/api/devices/code-runner', owner, { secret, slot: '6' })).token,
  );
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  runner = await api.connectDevice(owner, `app-code-runner-${mark}`);
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === `app-code-runner-${mark}`) as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...(device.scopes as string[]), 'run'],
      version: device.version,
    }),
  );
  maker = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `앱 코드 담당 ${mark}`,
      tool: 'claude',
    }),
    201,
  );
  while ((await worker.tick()) > 0);
});

after(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});

describe('앱 화면 (/api/apps/site/:slug)', () => {
  test('코드가 없는 공개 앱은 종류의 시작 코드로 그린다: 템플릿 · 데이터 · 파일', async () => {
    const app = await publish(await newApp(`code-a-${mark}`));
    await publicPost(app.id, `첫 글 ${mark}`);
    const home = ok(await screen(String(app.slug)));
    assert.deepEqual(
      [home.status, home.seq, home.template, home.redirect],
      [200, 0, 'index.html', null],
    );
    const templates = home.templates as Record<string, string>;
    assert.ok(templates['header.html']?.includes('{{app.name}}'), Object.keys(templates).join());
    // 탭 아이콘: 앱 아이콘, 없으면 종류의 기본 icon.svg
    assert.match(
      templates['head.html'] ?? '',
      /<link rel="icon" href="[^"]*\{\{files\}\}\/icon\.svg/,
    );
    const data = home.data as Json;
    assert.deepEqual([data.cairn, data.isHome, data.base], [1, true, `/${app.slug}`]);
    assert.equal((data.app as Json).name, app.name);
    assert.deepEqual(
      (data.posts as Json[]).map((p) => p.title),
      [`첫 글 ${mark}`],
    );
    assert.deepEqual(home.hosts, []);

    // 글 화면은 post.html, 앱 안의 없는 주소는 404.html (상태 404)
    const slug = (data.posts as Json[])[0]?.url as string;
    const post = ok(await screen(String(app.slug), slug.replace(`/${app.slug}/`, '')));
    assert.deepEqual([post.status, post.template], [200, 'post.html']);
    assert.equal((post.data as { post: Json }).post.body, `첫 글 ${mark}의 본문`);
    const missing = ok(await screen(String(app.slug), 'posts/없는-글'));
    assert.deepEqual([missing.status, missing.template], [404, '404.html']);
    const menu = ok(await screen(String(app.slug), 'm/posts'));
    assert.equal(menu.template, 'list.html');

    // 파일: 격리 머리글과 함께, 템플릿은 파일로 내보내지 않는다
    const css = await api.get(`/api/apps/site/${app.slug}/files/style.css`);
    assert.equal(css.status, 200, css.text);
    assert.match(String(css.header('content-security-policy')), /sandbox/);
    assert.match(String(css.header('content-type')), /text\/css/);
    assert.equal((await api.get(`/api/apps/site/${app.slug}/files/index.html`)).status, 404);
    const icon = await api.get(`/api/apps/site/${app.slug}/files/icon.svg`);
    assert.equal(icon.status, 200, icon.text);
    assert.match(String(icon.header('content-type')), /image\/svg\+xml/);
  });

  test('비공개 앱과 없는 앱은 같은 404. 관리자는 미리 보기 토큰 주소로 보내고, 토큰으로는 공개된 것처럼 본다', async () => {
    const app = await newApp(`code-b-${mark}`);
    await publicPost(app.id, `숨은 글 ${mark}`);
    const hidden = await screen(String(app.slug));
    const none = await screen(`none-${mark}`);
    assert.deepEqual([hidden.status, none.status], [404, 404]);
    assert.equal(hidden.json().message, none.json().message);
    assert.equal((await api.get(`/api/apps/site/${app.slug}/files/style.css`)).status, 404);

    const sent = ok(await screen(String(app.slug), 'm/posts', {}, owner));
    assert.match(String(sent.redirect), new RegExp(`^/${app.slug}/~[^/]+/m/posts$`));
    const token = String(sent.redirect).split('/')[2]?.slice(1) ?? '';
    const preview = ok(await screen(String(app.slug), '', { ticket: token }));
    assert.equal((preview.data as Json).base, `/${app.slug}/~${token}`);
    assert.deepEqual(
      ((preview.data as Json).posts as Json[]).map((p) => p.title),
      [`숨은 글 ${mark}`],
    );
    // 다른 앱의 이름으로는 이 토큰이 통하지 않는다
    const other = await publish(await newApp(`code-c-${mark}`));
    assert.equal((await screen(String(other.slug), '', { ticket: token })).status, 404);
    assert.equal((await screen(String(app.slug), '', { ticket: 'x' })).status, 404);
  });

  test('비공개 앱 미리 보기의 글 사진은 토큰으로 연다: 그 앱의 공개 · 링크 공개 글의 사진만', async () => {
    const app = await newApp(`code-photo-${mark}`);
    const shown = await publicPost(app.id, `사진 글 ${mark}`);
    const draft = ok(
      await api.request('POST', '/api/posts', owner, {
        requestId: randomUUID(),
        title: `초안 ${mark}`,
        appId: app.id,
      }),
      201,
    );
    const photo = async (postId: unknown) => {
      const png = Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        Buffer.from(randomUUID()),
      ]);
      const res = await fetch(`${api.baseUrl}/api/posts/${postId}/assets`, {
        method: 'POST',
        headers: { 'content-type': 'image/png', cookie: owner.header ?? '' },
        body: png,
      });
      assert.equal(res.status, 201);
      return String(((await res.json()) as Json).url);
    };
    const [inShown, inDraft] = [await photo(shown.id), await photo(draft.id)];
    const token = async (id: unknown) =>
      String(ok(await api.request('POST', `/api/apps/${id}/code/preview`, owner, {})).url).split(
        '~',
      )[1];
    const ticket = await token(app.id);

    assert.equal((await api.get(inShown)).status, 404);
    const seen = await api.get(`${inShown}?ticket=${ticket}`);
    assert.equal(seen.status, 200, seen.text);
    assert.equal(seen.header('cache-control'), 'no-store');
    assert.equal((await api.get(`${inShown}?ticket=~${ticket}`)).status, 200);
    // 초안의 사진 · 다른 앱의 토큰 · 틀린 토큰은 없는 파일과 같다
    assert.equal((await api.get(`${inDraft}?ticket=${ticket}`)).status, 404);
    const other = await token((await newApp(`code-photo2-${mark}`)).id);
    assert.equal((await api.get(`${inShown}?ticket=${other}`)).status, 404);
    assert.equal((await api.get(`${inShown}?ticket=x`)).status, 404);
  });

  test('다른 공개 앱에 든 글은 그 앱의 주소로 보낸다', async () => {
    const a = await publish(await newApp(`code-d-${mark}`));
    const b = await publish(await newApp(`code-e-${mark}`));
    const post = await publicPost(b.id, `옮긴 글 ${mark}`);
    const sent = ok(await screen(String(a.slug), `posts/${post.slug}`));
    assert.equal(sent.redirect, `/${b.slug}/posts/${encodeURIComponent(String(post.slug))}`);
  });
});

describe('페이지 앱 (P1, 2026-11-20): 블로그 틀 없는 화면 · 화면마다 템플릿 · 페이지가 화면', () => {
  test('시작 코드는 틀 없는 빈 정적 앱이고 (2026-11-25 A4), /<앱>/<이름>은 앱 코드의 <이름>.html이다', async () => {
    const app = await newApp(`page-p1-${mark}`, 'page');
    const starter = ok(await screen(String(app.slug), '', {}, owner));
    // 비공개 앱은 관리자를 미리 보기 토큰으로 보낸다: 시작 코드는 코드 탭에서 본다
    assert.ok(String(starter.redirect).includes('/~'));
    const files = ((await code(app)).files as Json[]).map((f) => f.name).sort();
    assert.deepEqual(
      files,
      ['cairn.json', 'icon.svg', 'index.html', 'style.css'],
      '머리 · 메뉴 · 꼬리 · 글 목록 없음, 정적 앱 선언',
    );

    // 비공개 앱의 새 버전은 바로 보인다. 공개한 뒤 방문자가 화면마다 다른 템플릿을 본다
    const zip = {
      'index.html': '<a href="{{base}}/about">소개</a>',
      'about.html': '<h1>{{#isView}}{{view}}{{/isView}}</h1>',
    };
    ok(await upload(app, zipOf(zip)), 201);
    await publish(app);
    const home = ok(await screen(String(app.slug)));
    assert.deepEqual([home.status, home.template, home.page], [200, 'index.html', null]);
    const about = ok(await screen(String(app.slug), 'about'));
    assert.deepEqual([about.status, about.template], [200, 'about.html']);
    assert.deepEqual([(about.data as Json).isView, (about.data as Json).view], [true, 'about']);
    for (const path of ['none', 'posts', 'index', 'a/b']) {
      const missing = ok(await screen(String(app.slug), path));
      assert.deepEqual([missing.status, missing.template], [404, null], path);
    }
  });

  test('앱 코드를 만든 적이 없는 페이지 앱은 공개 페이지가 화면이다. 페이지가 비공개거나 코드를 공개하면 앱 코드', async () => {
    const title = `페이지 화면 ${mark}`;
    const task = ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        kind: 'make',
        agentId: maker.id,
        instruction: '페이지를 만들어 주세요',
        page: { title },
      }),
      201,
    );
    await lease(String(task.id));
    await deliver(String(task.id), { 'index.html': '<p>페이지</p>', 'data.json': '{"n":1}' });
    const page = (ok(await api.get('/api/pages', owner)).pages as Json[]).find(
      (p) => p.title === title,
    ) as Json;
    ok(
      await api.request('PATCH', `/api/pages/${page.id}`, owner, {
        version: page.version,
        visibility: 'public',
      }),
    );
    const app = ok(
      await api.request('POST', '/api/apps', owner, {
        requestId: randomUUID(),
        kind: 'page',
        name: `페이지 앱 ${mark}`,
        slug: `page-shown-${mark}`,
        pageId: page.id,
      }),
      201,
    );
    await publish(app);
    const slug = String(app.slug);
    const home = ok(await screen(slug));
    assert.deepEqual(home.page, { name: page.name, file: null, base: `/${slug}` });
    assert.deepEqual(ok(await screen(slug, 'data.json')).page, {
      name: page.name,
      file: 'data.json',
      base: `/${slug}`,
    });
    const deep = ok(await screen(slug, 'a/b'));
    assert.deepEqual(
      [deep.page, (deep.static as Json).file],
      [null, 'index.html'],
      '페이지의 파일은 한 칸짜리 주소: 더 깊으면 앱 코드(정적 시작 코드의 첫 화면)',
    );

    // 페이지를 비공개로 돌리면 앱 코드(정적 시작 코드)가 화면이다
    const now = (ok(await api.get('/api/pages', owner)).pages as Json[]).find(
      (p) => p.id === page.id,
    ) as Json;
    ok(
      await api.request('PATCH', `/api/pages/${page.id}`, owner, {
        version: now.version,
        visibility: 'private',
      }),
    );
    const starter = ok(await screen(slug));
    assert.deepEqual([starter.page, (starter.static as Json).file], [null, 'index.html']);
    ok(
      await api.request('PATCH', `/api/pages/${page.id}`, owner, {
        version: Number(now.version) + 1,
        visibility: 'public',
      }),
    );
    assert.notEqual(ok(await screen(slug)).page, null);

    // 앱 코드를 공개하면(보이는 버전이 생기면) 앱 코드가 화면이다. 확인 대기 버전만으로는 그대로
    ok(await upload(app, zipOf({ 'index.html': '<p>앱 코드</p>' })), 201);
    assert.notEqual(ok(await screen(slug)).page, null, '확인 대기');
    ok(
      await api.request('POST', `/api/apps/${app.id}/code/current`, owner, {
        version: (await appOf(app.id)).version,
        seq: 1,
      }),
    );
    const coded = ok(await screen(slug));
    assert.deepEqual([coded.page, coded.seq, coded.template], [null, 1, 'index.html']);
  });
});

describe('앱 코드 (/api/apps/:id/code)', () => {
  test('zip 올리기: 공개 앱의 새 버전은 확인 대기, 관리자가 공개하면 방문자에게 보인다', async () => {
    const app = await publish(await newApp(`code-f-${mark}`));
    const files = {
      'index.html':
        '<!doctype html><title>{{app.name}}</title><p>{{#posts}}{{title}}{{/posts}}</p>',
      'style.css': 'p{color:red}',
      'cairn.json': JSON.stringify({ cairn: 1, hosts: ['fonts.googleapis.com'] }),
    };
    const state = ok(await upload(app, zipOf(files)), 201);
    assert.deepEqual([state.current, state.pending, state.latest], [null, 1, 1]);
    // 방문자는 아직 시작 코드
    assert.equal(ok(await screen(String(app.slug))).seq, 0);
    const notices = ok(await api.get('/api/notifications', owner)).notifications as Json[];
    assert.ok(
      notices.some((n) => String(n.title).startsWith('앱 코드 확인') && n.read === false),
      JSON.stringify(notices.slice(0, 3)),
    );

    // 미리 보기 토큰은 그 버전에 묶인다
    const { url } = ok(
      await api.request('POST', `/api/apps/${app.id}/code/preview`, owner, { seq: 1 }),
    );
    const token = String(url).split('/')[2]?.slice(1) ?? '';
    const preview = ok(await screen(String(app.slug), '', { ticket: token }));
    assert.deepEqual([preview.seq, preview.hosts], [1, ['fonts.googleapis.com']]);

    const changes = ok(await api.get(`/api/apps/${app.id}/code/versions/1/changes`, owner));
    assert.deepEqual(changes.hostsAdded, ['fonts.googleapis.com']);
    assert.ok((changes.removed as string[]).includes('post.html'), JSON.stringify(changes));
    assert.ok((changes.added as string[]).includes('cairn.json'));

    const shown = ok(
      await api.request('POST', `/api/apps/${app.id}/code/current`, owner, {
        version: (await appOf(app.id)).version,
        seq: 1,
      }),
    );
    assert.deepEqual([shown.current, shown.pending], [1, null]);
    const live = ok(await screen(String(app.slug)));
    assert.deepEqual(
      [live.seq, live.template, live.hosts],
      [1, 'index.html', ['fonts.googleapis.com']],
    );
    // 이 버전에 post.html이 없으니 글 화면도 index.html
    assert.equal(ok(await screen(String(app.slug), 'm/posts')).template, 'index.html');
    // 확인 알림은 읽음으로
    const after = ok(await api.get('/api/notifications', owner)).notifications as Json[];
    assert.ok(
      after
        .filter((n) => String(n.title).startsWith(`앱 코드 확인 · ${app.name}`))
        .every((n) => n.read === true),
    );

    // zip 받기: 그 버전의 파일 그대로
    const res = await fetch(`${api.baseUrl}/api/apps/${app.id}/code/versions/1/zip`, {
      headers: { cookie: owner.header },
    });
    assert.equal(res.status, 200);
    const names = [...ZipReader.read(Buffer.from(await res.arrayBuffer())).keys()].sort();
    assert.deepEqual(names, ['cairn.json', 'index.html', 'style.css']);
  });

  test('비공개 앱의 새 버전은 바로 보이는 버전이 된다. 시작 코드로 되돌리기도 새 버전', async () => {
    const app = await newApp(`code-g-${mark}`, 'magazine');
    const state = ok(await upload(app, zipOf({ 'index.html': '<p>v1</p>' })), 201);
    assert.deepEqual([state.current, state.pending], [1, null]);
    const reset = ok(
      await api.request('POST', `/api/apps/${app.id}/code/starter`, owner, {
        version: (await appOf(app.id)).version,
      }),
    );
    assert.deepEqual([reset.current, reset.latest], [2, 2]);
    const detail = await code(app);
    assert.deepEqual(
      (detail.versions as Json[]).map((v) => v.source),
      ['starter', 'upload'],
    );
    assert.ok((detail.files as Json[]).some((f) => f.name === 'issue.html'));
  });

  test('묶음 규칙: zip 아님 415, 폴더 · index.html 없음 · 틀린 바깥 주소 422. 폴더 하나로 감싼 zip은 벗긴다', async () => {
    const app = await newApp(`code-h-${mark}`);
    assert.equal((await upload(app, Buffer.from('nope'), owner)).status, 415);
    const nested = await upload(app, zipOf({ 'a/index.html': 'x', 'b/style.css': 'y' }));
    assert.equal(nested.status, 422, nested.text);
    assert.equal((await upload(app, zipOf({ 'style.css': 'y' }))).status, 422);
    for (const hosts of [['*.example.com'], ['127.0.0.1'], ['example.com:443']]) {
      const res = await upload(
        app,
        zipOf({ 'index.html': 'x', 'cairn.json': JSON.stringify({ hosts }) }),
      );
      assert.equal(res.status, 422, `${hosts} ${res.text}`);
    }
    const wrapped = ok(
      await upload(app, zipOf({ 'site/index.html': 'x', 'site/__MACOSX/._x': 'y' })),
      201,
    );
    assert.equal(wrapped.latest, 1);
  });

  test('관리자만: 방문자 · write 기기는 읽지도 올리지도 공개하지도 못한다', async () => {
    const app = await newApp(`code-i-${mark}`);
    assert.equal((await api.get(`/api/apps/${app.id}/code`)).status, 403);
    assert.equal(
      (await api.request('GET', `/api/apps/${app.id}/code`, TestUser.visitor, undefined, writer))
        .status,
      403,
    );
    assert.equal((await upload(app, zipOf({ 'index.html': 'x' }), writer)).status, 403);
    const show = await api.request(
      'POST',
      `/api/apps/${app.id}/code/current`,
      TestUser.visitor,
      { version: 1, seq: 1 },
      writer,
    );
    assert.equal(show.status, 403);
  });
});

// 정적 앱 (스토어 9.13, 2026-11-21 "템플릿 없는 자유로운 앱"): cairn.json에 "render": "static"이면 템플릿을 거치지 않고
// 묶음의 파일을 그대로 내보낸다. 폴더가 든 이름 · 앱 안의 화면 전환(없는 주소 → index.html). 어느 종류의 앱이든 (2026-11-25 A4)
describe('정적 앱 ("render": "static")', () => {
  const STATIC = JSON.stringify({ cairn: 1, render: 'static' });
  const site = {
    'index.html': '<html><head><title>지도</title></head><body><div id="app"></div></body></html>',
    'assets/app.js': 'console.log("app")',
    'assets/img/pin.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'about/index.html': '<html><head></head><body>소개</body></html>',
    'design.md': '# 디자인 문서: 지도\n## 참고한 곳\n- https://maps.example/',
    'cairn.json': STATIC,
  };

  test('폴더가 든 묶음을 그대로 내보낸다: 주소 → 파일, 폴더는 그 안의 index.html, 없는 화면 주소는 첫 화면', async () => {
    const app = await newApp(`static-a-${mark}`, 'page');
    const made = ok(await upload(app, zipOf(site)), 201);
    assert.equal(made.latest, 1);
    await publish(app);
    const slug = `static-a-${mark}`;
    const at = async (path: string) => ok(await screen(slug, path)) as Json;

    const home = await at('');
    assert.deepEqual([home.status, home.seq, home.redirect, home.page], [200, 1, null, null]);
    assert.deepEqual(home.static, { file: 'index.html', text: site['index.html'] });
    assert.equal(((home.data as Json).app as Json).kind, 'page');
    assert.equal((home.data as Json).base, `/${slug}`);
    assert.equal(home.templates, undefined, '템플릿을 싣지 않는다');

    assert.deepEqual((await at('assets/app.js')).static, { file: 'assets/app.js', text: null });
    assert.deepEqual((await at('about')).static, {
      file: 'about/index.html',
      text: site['about/index.html'],
    });
    assert.deepEqual(
      ((await at('places/3')).static as Json).file,
      'index.html',
      '확장자 없는 없는 주소는 첫 화면 (앱 안의 화면 전환)',
    );
    // 데이터는 그 주소의 것 (2026-11-25 스토어 14 A3): 첫 화면은 home, 페이지 앱의 다른 주소는 view, 앱 JS가 맡는 깊은 주소는 missing
    assert.equal((home.data as Json).screen, 'home');
    assert.equal(((await at('about')).data as Json).screen, 'view');
    assert.equal(((await at('places/3')).data as Json).screen, 'missing');
    const missing = await at('assets/none.png');
    assert.deepEqual([missing.status, (missing.static as Json).file], [404, null]);

    const js = await api.get(`/api/apps/site/${slug}/files/assets/app.js`);
    assert.equal(js.status, 200, js.text);
    assert.equal(js.text, site['assets/app.js']);
    assert.match(js.header('content-type') ?? '', /javascript/);
    assert.equal(
      js.header('access-control-allow-origin'),
      '*',
      '격리된 화면이 모듈 스크립트로 읽는다',
    );
    assert.match(js.header('content-security-policy') ?? '', /sandbox/);
    assert.equal((await api.get(`/api/apps/site/${slug}/files/assets/img/pin.svg`)).status, 200);
    for (const path of ['index.html', 'about/index.html', 'assets/.env', 'assets/none.js'])
      assert.equal((await api.get(`/api/apps/site/${slug}/files/${path}`)).status, 404, path);
    // 디자인 문서는 일꾼의 것이라 방문자에게 내보내지 않는다 (2026-11-25): 파일로도 화면으로도
    assert.equal((await api.get(`/api/apps/site/${slug}/files/design.md`)).status, 404);
    assert.deepEqual(
      [(await at('design.md')).status, ((await at('design.md')).static as Json).file],
      [404, null],
    );

    const detail = await code(app);
    assert.deepEqual((detail.files as Json[]).map((f) => f.name).sort(), Object.keys(site).sort());
    const zip = await fetch(`${api.baseUrl}/api/apps/${app.id}/code/versions/1/zip`, {
      headers: { cookie: owner.header ?? '' },
    });
    const names = [...ZipReader.read(Buffer.from(await zip.arrayBuffer()))].map(([name]) => name);
    assert.ok(names.includes('assets/img/pin.svg'), names.join());
  });

  test('규칙: 블로그 앱도 정적 앱이 된다, 폴더는 정적 앱만, 모르는 render · 너무 깊은 폴더 · 숨김 파일은 422', async () => {
    const blog = await newApp(`static-b-${mark}`);
    const onBlog = await upload(blog, zipOf({ 'index.html': 'x', 'cairn.json': STATIC }));
    assert.equal(onBlog.status, 201, onBlog.text);
    const page = await newApp(`static-c-${mark}`, 'page');
    const folders = await upload(
      page,
      zipOf({ 'index.html': 'x', 'assets/app.js': 'y', 'z.css': '' }),
    );
    assert.equal(folders.status, 422, folders.text);
    assert.match(folders.text, /render/);
    const bad: Record<string, string>[] = [
      { 'index.html': 'x', 'cairn.json': JSON.stringify({ render: 'server' }) },
      { 'index.html': 'x', 'a/b/c/d/e/f/g.js': 'y', 'cairn.json': STATIC },
      { 'index.html': 'x', 'assets/.secret': 'y', 'cairn.json': STATIC },
    ];
    for (const files of bad) {
      const res = await upload(page, zipOf(files));
      assert.equal(res.status, 422, `${Object.keys(files).join()} ${res.text}`);
    }
    assert.equal((await code(page)).latest, 0, '거절한 묶음은 버전이 되지 않는다');
  });

  test('AI의 결과물에 app.zip이 있으면 그 안이 묶음 전체다 (폴더가 있는 빌드 결과)', async () => {
    const app = await newApp(`static-d-${mark}`, 'page');
    const { taskId } = await build(app, { 'app.zip': zipOf({ ...site, 'dist.txt': 'built' }) });
    const detail = await code(app);
    assert.deepEqual([detail.current, detail.latest], [1, 1]);
    const [version] = detail.versions as Json[];
    assert.deepEqual([version?.source, version?.taskId], ['task', taskId]);
    const names = (detail.files as Json[]).map((f) => f.name);
    assert.ok(names.includes('assets/app.js') && names.includes('dist.txt'), names.join());
    assert.ok(
      !names.includes('app.zip') && !names.includes('style.css'),
      '시작 코드 위에 얹지 않는다',
    );

    // 다음 버전: zip에 없는 글 파일은 사라지고, AI가 내용을 받지 못한 파일(그림)은 남는다
    ok(await upload(app, zipOf({ ...site, 'dist.txt': 'built', 'assets/photo.png': 'PNG' })), 201);
    await build(app, { 'app.zip': zipOf({ ...site, 'assets/app.js': 'console.log(2)' }) });
    const next = ((await code(app)).files as Json[]).map((f) => f.name);
    assert.ok(next.includes('assets/photo.png'), `받지 못한 파일은 남는다: ${next.join()}`);
    assert.ok(!next.includes('dist.txt'), `zip에 없는 글 파일은 사라진다: ${next.join()}`);

    // 블로그 앱도 정적 묶음이 버전이 된다 (2026-11-25 A4)
    const blog = await newApp(`static-e-${mark}`);
    await build(blog, { 'app.zip': zipOf(site) });
    assert.equal((await code(blog)).latest, 1);
  });
});

describe('배포 도구 (MCP app_code_upload → PUT …/code/versions, 스토어 12.5)', () => {
  const site = {
    'index.html': '<html><head></head><body>배포</body></html>',
    'assets/app.js': 'console.log(1)',
    'cairn.json': JSON.stringify({ cairn: 1, render: 'static' }),
  };
  const token = () => (writer.authorization ?? '').replace('Bearer ', '');
  const begin = (bearer: string, slug: string, zip: Buffer, note?: string) =>
    mcp(bearer, 'app_code_upload', {
      app: slug,
      size: zip.length,
      sha256: sha(zip),
      ...(note ? { note } : {}),
    });
  /** 받은 표로 묶음을 낸다 (로그인 없이) */
  const put = async (ticket: Json, zip: Buffer, path = String(ticket.upload_path)) => {
    const res = await fetch(`${api.baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/zip', [String(ticket.header)]: String(ticket.token) },
      body: new Uint8Array(zip),
    });
    return { status: res.status, text: await res.text() };
  };

  test('write 기기가 표를 받아 묶음을 올린다: 비공개 앱은 바로 보이고, 공개 앱은 확인 대기', async () => {
    const slug = `deploy-a-${mark}`;
    const app = await newApp(slug, 'page');
    const zip = zipOf(site);
    const ticket = await begin(token(), slug, zip);
    assert.equal(ticket.upload_path, `/api/apps/${app.id}/code/versions`);
    assert.equal(ticket.header, 'x-cairn-deploy');
    const first = await put(ticket, zip);
    assert.equal(first.status, 200, first.text);
    const state = JSON.parse(first.text) as Json;
    assert.deepEqual([state.current, state.pending, state.latest], [1, null, 1]);
    const versions = (await code(app)).versions as Json[];
    assert.deepEqual([versions[0]?.source, versions[0]?.note], ['upload', '배포']);

    // 같은 표는 다시 쓸 수 없다: 그사이 버전이 생겼다
    assert.equal((await put(ticket, zip)).status, 409);

    await publish(app);
    const second = zipOf({ ...site, 'index.html': '<html><head></head><body>둘째</body></html>' });
    const next = await put(await begin(token(), slug, second, '둘째 배포'), second);
    assert.equal(next.status, 200, next.text);
    const held = JSON.parse(next.text) as Json;
    assert.deepEqual([held.current, held.pending, held.latest], [1, 2, 2]);
    const shown = ok(await screen(slug, '')) as Json;
    assert.equal(
      (shown.static as Json).text,
      site['index.html'],
      '공개 앱은 관리자가 공개해야 바뀐다',
    );
  });

  test('표 없이 · 다른 묶음 · 다른 앱 · 틀린 묶음은 거절한다', async () => {
    const slug = `deploy-b-${mark}`;
    const app = await newApp(slug, 'page');
    const other = await newApp(`deploy-b2-${mark}`, 'page');
    const zip = zipOf(site);
    const ticket = await begin(token(), slug, zip);

    assert.equal((await put({ ...ticket, token: '' }, zip)).status, 403, '표 없이');
    assert.equal((await put({ ...ticket, token: 'x.y.z' }, zip)).status, 403, '틀린 표');
    const changed = zipOf({ ...site, 'assets/app.js': 'console.log(2)' });
    assert.equal((await put(ticket, changed)).status, 403, '표와 다른 묶음');
    assert.equal(
      (await put(ticket, zip, `/api/apps/${other.id}/code/versions`)).status,
      403,
      '다른 앱에는 쓸 수 없다',
    );
    const bad = zipOf({ 'a.txt': 'x' });
    const refused = await put(await begin(token(), slug, bad), bad);
    assert.equal(refused.status, 422, refused.text);
    assert.equal(((await code(app)).versions as Json[]).length, 0, '쌓인 버전이 없다');

    const call = async (bearer: string, args: Json) => {
      const res = await api.mcp(bearer, 'tools/call', { name: 'app_code_upload', arguments: args });
      return (res.json().result as { isError?: boolean } | undefined)?.isError;
    };
    const args = { size: zip.length, sha256: sha(zip) };
    assert.equal(await call(token(), { ...args, app: `none-${mark}` }), true, '없는 앱');
    assert.equal(await call(token(), { ...args, app: slug, size: 0 }), true, '빈 묶음');
    const plain = await api.connectDevice(owner, `deploy-plain-${mark}`);
    assert.notEqual(await call(plain, { ...args, app: slug }), false, 'write 없는 기기');
    assert.equal((await call(plain, { ...args, app: slug })) ?? true, true);
  });

  test('배포 기기(scope=deploy)는 쓰기만 받아 이 도구를 쓴다', async () => {
    const slug = `deploy-c-${mark}`;
    await newApp(slug, 'page');
    const deployer = await api.connectDevice(owner, `deployer-${mark}`, 'deploy');
    const zip = zipOf(site);
    const made = await put(await begin(deployer, slug, zip), zip);
    assert.equal(made.status, 200, made.text);
    assert.equal((JSON.parse(made.text) as Json).latest, 1);
  });
});

describe('AI로 고치기 (payload.appCode → task.app_code.built)', () => {
  test('러너는 시작 코드를 받고, 바꾼 파일만 낸 결과가 그 위에 얹힌 새 버전이 된다', async () => {
    const app = await publish(await newApp(`code-j-${mark}`));
    const { base, taskId } = await build(app, { 'style.css': 'body{background:#f7f3ec}' });
    assert.deepEqual([base.app_id, base.seq], [app.id, 0]);
    const names = (base.files as Json[]).map((f) => f.name);
    assert.ok(names.includes('index.html') && names.includes('header.html'), names.join());
    assert.ok((base.files as Json[]).every((f) => typeof f.text === 'string'));

    const detail = await code(app);
    assert.deepEqual([detail.current, detail.pending], [null, 1]);
    const [version] = detail.versions as Json[];
    assert.deepEqual([version?.source, version?.taskId], ['task', taskId]);
    const changes = ok(await api.get(`/api/apps/${app.id}/code/versions/1/changes`, owner));
    assert.deepEqual([changes.added, changes.changed, changes.removed], [[], ['style.css'], []]);
    const task = ok(await api.get(`/api/tasks/${taskId}`, owner));
    assert.deepEqual(task.appCode, { appId: app.id });
    // 같은 이벤트를 다시 받아도 버전은 하나
    assert.equal(await api.unprocessed('task.app_code.built'), 0);
  });

  test('앱 코드 주문은 만들기 일에만, 한 앱에 한 번에 하나', async () => {
    const app = await newApp(`code-k-${mark}`);
    const wrong = await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      kind: 'write',
      instruction: '글',
      appCode: { appId: app.id },
    });
    assert.equal(wrong.status, 422, wrong.text);
    const make = (requestId: string) =>
      api.request('POST', '/api/tasks', owner, {
        requestId,
        kind: 'make',
        agentId: maker.id,
        instruction: '앱 코드',
        appCode: { appId: app.id },
      });
    ok(await make(randomUUID()), 201);
    assert.equal((await make(randomUUID())).status, 409);
  });
});

describe('대화에서 맡기기 (스토어 1-6b)', () => {
  /** 칸이 아닌 러너가 이 대화의 회차를 빌린다 */
  async function turnOf(chatId: unknown): Promise<Json> {
    const { jobs } = (await mcp(runner, 'next_jobs', { limit: 5, tools: ['claude'] })) as {
      jobs: Json[];
    };
    const job = jobs.find(
      (j) =>
        ((j.task as Json).payload as Json | null)?.chat !== undefined &&
        (((j.task as Json).payload as Json).chat as Json).chatId === chatId,
    );
    assert.ok(job, '대화의 회차를 빌리지 못했어요');
    return job;
  }
  const finish = (job: Json) =>
    mcp(runner, 'submit_result', {
      task_id: (job.task as Json).id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '맡긴 일이 끝났어요' },
    });
  const drain = async () => {
    for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  };

  test('대표가 일꾼에게 make 일을 app_id로 맡기면 새 버전이 되고, 공개 앱이면 결과 카드에서 공개를 고른다', async () => {
    const app = await publish(await newApp(`code-chat-${mark}`));
    // 대화는 대표가 맡고(O-2), 대표는 일꾼 누구에게나 맡긴다 (2026-11-21)
    const member = ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: `앱 꾸미기 ${mark}`,
        tool: 'claude',
      }),
      201,
    );
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '글 목록을 카드로 바꿔 줘',
      }),
      201,
    );
    await drain();
    const turn = await turnOf(chat.id);
    // make가 아닌 일에는 app_id를 적지 못한다
    const wrong = await api.mcp(String(turn.run_token), 'tools/call', {
      name: 'delegate_task',
      arguments: {
        subtasks: [
          {
            request_id: randomUUID(),
            to_agent_id: member.id,
            kind: 'general',
            title: '카드',
            instruction: '카드로',
            app_id: app.id,
          },
        ],
      },
    });
    assert.equal((wrong.json().result as Json).isError, true, wrong.text);
    const delegated = await mcp(String(turn.run_token), 'delegate_task', {
      subtasks: [
        {
          request_id: randomUUID(),
          to_agent_id: member.id,
          kind: 'make',
          title: '글 목록 카드',
          instruction: '글 목록을 카드 두 줄로',
          app_id: app.id,
        },
      ],
    });
    const subtaskId = String(((delegated.subtasks as Json[])[0] as Json).task_id);
    const sub = ok(await api.get(`/api/tasks/${subtaskId}`, owner));
    assert.deepEqual(sub.appCode, { appId: app.id });

    await lease(subtaskId);
    const base = await mcp(slot, 'app_code_base', { task_id: subtaskId });
    assert.equal(base.app_id, app.id);
    await deliver(subtaskId, {
      'post-list.html': '<ul>{{#posts}}<li>{{title}}</li>{{/posts}}</ul>',
    });
    assert.deepEqual([(await code(app)).current, (await code(app)).pending], [null, 1]);

    await finish(await turnOf(chat.id));
    await drain();
    const card = (ok(await api.get(`/api/chats/${chat.id}`, owner)).card ?? null) as Json | null;
    assert.ok(card, '결과 카드가 없어요');
    const items = card.items as Json[];
    assert.deepEqual(
      items.map((i) => [i.kind, i.action, i.targetId, i.targetVersion, i.note]),
      [['action', 'blog.app_code.show', app.id, 1, `${app.name} 버전 1`]],
      '앱 코드 일의 결과물(파일)은 카드에 싣지 않고 공개 승인 하나만',
    );
    // 같은 이벤트가 다시 와도 결재는 하나
    assert.equal(await api.unprocessed('blog.app_code.added'), 0);

    ok(
      await api.request('POST', `/api/approvals/${card.id}/decide`, owner, {
        version: card.version,
        decision: 'approve',
        picked: [items[0]?.id],
      }),
    );
    await drain();
    assert.deepEqual([(await code(app)).current, (await code(app)).pending], [1, null]);
  });

  test('검수 승인을 켜면 앱 화면 공개는 검수자가 app_code_base로 코드를 읽고, 통과하면 카드 없이 보인다 (2026-11-20)', async () => {
    const app = await publish(await newApp(`code-inspect-${mark}`));
    const agent = (name: string, more: Json) =>
      api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: `${name} ${mark}`,
        tool: 'claude',
        ...more,
      });
    const member = ok(await agent('앱 화면 검수 대상', {}), 201);
    const inspector = ok(await agent('앱 화면 검수자', { tool: 'codex' }), 201);
    const lead = async () => ok(await api.get('/api/agents/lead', owner)).lead as Json;
    const editLead = async (body: Json) =>
      ok(
        await api.request('PATCH', `/api/agents/${(await lead()).id}`, owner, {
          ...body,
          version: (await lead()).version,
        }),
      );
    await editLead({ reviewerId: inspector.id, reviewerApproves: true });
    try {
      const chat = ok(
        await api.request('POST', '/api/chats', owner, {
          requestId: randomUUID(),
          message: '첫 화면을 바꿔 줘',
        }),
        201,
      );
      await drain();
      const turn = await turnOf(chat.id);
      const delegated = await mcp(String(turn.run_token), 'delegate_task', {
        subtasks: [
          {
            request_id: randomUUID(),
            to_agent_id: member.id,
            kind: 'make',
            title: '첫 화면',
            instruction: '첫 화면을 바꾼다',
            app_id: app.id,
          },
        ],
      });
      const subtaskId = String(((delegated.subtasks as Json[])[0] as Json).task_id);
      await lease(subtaskId);
      await deliver(subtaskId, { 'index.html': '<main>검수할 화면</main>' });
      await finish(await turnOf(chat.id));
      await drain();
      const { jobs } = (await mcp(runner, 'next_jobs', { limit: 5 })) as {
        jobs: Json[];
      };
      const inspection = jobs.find(
        (j) =>
          (((j.task as Json).payload as Json).inspect as Json | undefined)?.action ===
          'blog.app_code.show',
      );
      assert.ok(inspection, '검수 작업이 없어요');
      assert.equal(
        ok(await api.get(`/api/chats/${chat.id}`, owner)).card,
        null,
        '검수 중에는 카드 없음',
      );
      // 러너(빌린 기기)가 검수 일의 앱 코드를 받아 작업 폴더에 둔다 (AI의 실행 토큰은 받지 못한다)
      const base = await mcp(runner, 'app_code_base', { task_id: (inspection.task as Json).id });
      assert.equal(base.app_id, app.id, '검수 작업은 그 앱의 코드를 읽는다');
      const index = (base.files as Json[]).find((f) => f.name === 'index.html');
      assert.equal(index?.text, '<main>검수할 화면</main>', '확인 대기 버전을 본다');
      await mcp(runner, 'submit_result', {
        task_id: (inspection.task as Json).id,
        request_id: randomUUID(),
        status: 'done',
        result: { text: JSON.stringify({ verdict: 'pass', summary: '괜찮아요', fixes: [] }) },
      });
      await drain();
      assert.deepEqual([(await code(app)).current, (await code(app)).pending], [1, null]);
      assert.equal(
        ok(await api.get(`/api/chats/${chat.id}`, owner)).card,
        null,
        '관리자의 카드 없음',
      );
    } finally {
      await editLead({ reviewerId: null });
    }
  });

  test('비공개 앱: 받을 것이 앱 코드인 회차는 make 일이 끝나면 다시 맡기지 않는다 (승인 없이 바로 보인다, 스토어 2-6)', async () => {
    // 대화로 만든 페이지 앱은 페이지 없이 생기고 화면은 앱 코드다
    const app = await newApp(`code-private-${mark}`, 'page');
    const member = ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: `일정표 화면 ${mark}`,
        tool: 'claude',
      }),
      201,
    );
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '여행 일정표 화면을 만들어 줘',
      }),
      201,
    );
    await drain();
    const turn = await turnOf(chat.id);
    await mcp(String(turn.run_token), 'set_deliver', { deliver: 'app_code', note: '앱 화면' });
    const delegated = await mcp(String(turn.run_token), 'delegate_task', {
      subtasks: [
        {
          request_id: randomUUID(),
          to_agent_id: member.id,
          kind: 'make',
          title: '일정표',
          instruction: '사흘 일정표 화면',
          app_id: app.id,
        },
      ],
    });
    const subtaskId = String(((delegated.subtasks as Json[])[0] as Json).task_id);
    await lease(subtaskId);
    await deliver(subtaskId, { 'index.html': '<main>{{app.name}} 일정표</main>' });
    assert.deepEqual(
      [(await code(app)).current, (await code(app)).pending],
      [1, null],
      '비공개 앱의 새 버전은 바로 보인다',
    );

    await finish(await turnOf(chat.id));
    await drain();
    const detail = ok(await api.get(`/api/chats/${chat.id}`, owner));
    assert.equal((detail.turns as Json[]).length, 1, '받을 것이 있어 다시 맡기지 않는다');
    assert.equal(detail.card, null, '카드에 실을 승인이 없다');
  });

  test('결과 카드의 공개 승인은 그사이 더 새 버전이 보이면 앞 버전으로 되돌리지 않는다', async () => {
    const app = await publish(await newApp(`code-chat2-${mark}`));
    for (const n of ['1', '2']) {
      assert.equal((await upload(app, zipOf({ 'index.html': `<p>${n}</p>` }))).status, 201);
      ok(
        await api.request('POST', `/api/apps/${app.id}/code/current`, owner, {
          version: (await appOf(app.id)).version,
          seq: Number(n),
        }),
      );
    }
    // 결과 카드에서 버전 1의 공개를 승인한 것과 같은 이벤트 (작업에 묶이지 않은 결재)
    const db = api.service(Database);
    const [row] = await db.sql`SELECT space_id FROM blog.apps WHERE id = ${String(app.id)}`;
    const granted = (action: string) => db.sql`
      INSERT INTO platform.outbox (space_id, topic, payload)
      VALUES (${String(row?.space_id)}, 'task.approval.granted', ${db.sql.json({
        v: 1,
        approvalId: randomUUID(),
        taskId: null,
        agentId: randomUUID(),
        action,
        targetKind: 'app',
        targetId: String(app.id),
        targetVersion: 1,
        decidedBy: randomUUID(),
        note: null,
        chatId: randomUUID(),
        payload: null,
      })})`;
    await granted('blog.app_code.show');
    while ((await worker.tick()) > 0);
    assert.equal((await code(app)).current, 2, '앞 버전으로 되돌리지 않는다');
  });
});
