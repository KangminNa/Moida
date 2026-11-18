import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, ApiResult, TestUser } from '../../../testing/api-client';

// /api/apps (스토어 1단계): 앱 목록 · 머리 · 아이콘은 누구나(방문자는 공개 앱만), 만들기 · 고치기 · 지우기 · 아이콘은 관리자만.
// 비공개 앱의 글 · 메뉴 · 호 · 사진 · 아이콘은 방문자에게 없는 것과 같다 (원칙 5).

type Json = Record<string, unknown>;

/** 앞부분만 PNG인 그림 (서버는 그림을 풀지 않는다) */
const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(32)]);

let api: ApiClient;
let owner: TestUser;
/** write 권한을 준 기기의 Bearer 머리글. 관리 일은 이 기기에게도 막혀야 한다 */
let writer: Readonly<Record<string, string>>;
const mark = randomUUID().slice(0, 6);

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const createApp = (body: Json, as = owner, headers: Record<string, string> = {}) =>
  api.request('POST', '/api/apps', as, { requestId: randomUUID(), ...body }, headers);

/** 관리자가 만든 앱 하나 (비공개) */
async function newApp(slug: string, more: Json = {}): Promise<Json> {
  return ok(await createApp({ kind: 'blog', name: `앱 ${slug}`, slug, ...more }), 201);
}

async function setVisibility(app: Json, visibility: string): Promise<Json> {
  return ok(
    await api.request('PATCH', `/api/apps/${app.id}`, owner, { version: app.version, visibility }),
  );
}

/** 앱에 든 공개 글 하나 */
async function publicPost(appId: unknown, title: string): Promise<Json> {
  const post = ok(
    await api.request('POST', '/api/posts', owner, { requestId: randomUUID(), title, appId }),
    201,
  );
  return ok(
    await api.request('POST', `/api/posts/${post.id}/status`, owner, {
      version: post.version,
      status: 'published',
    }),
  );
}

/** 아이콘 올리기: 본문이 그림 파일 그대로라 fetch로 직접 보낸다 */
async function putIcon(app: Json, body: Buffer | string, type: string, as = owner) {
  const res = await fetch(`${api.baseUrl}/api/apps/${app.id}/icon?version=${app.version}`, {
    method: 'PUT',
    headers: { 'content-type': type, ...(as.header ? { cookie: as.header } : {}) },
    body,
  });
  return new ApiResult(res.status, await res.text(), res.headers);
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, `app-writer-${mark}`)}` };
});
after(() => api.close());

describe('앱 (/api/apps)', () => {
  test('관리자가 만들면 비공개로 시작하고 종류의 시작 메뉴가 생긴다. 같은 requestId는 한 번', async () => {
    const requestId = randomUUID();
    const body = { requestId, kind: 'blog', name: '개발 블로그', slug: `dev-${mark}` };
    const made = ok(await api.request('POST', '/api/apps', owner, body), 201);
    const again = ok(await api.request('POST', '/api/apps', owner, body), 201);
    assert.equal(again.id, made.id, '같은 requestId는 처음 것');
    assert.deepEqual(
      [made.kind, made.visibility, made.iconUrl, made.counts],
      ['blog', 'private', null, null],
    );
    const menus = async (q: string) =>
      (ok(await api.get(`/api/menus?app=${q}`, owner)).menus as Json[]).map((m) => [
        m.name,
        m.kind,
      ]);
    assert.deepEqual(await menus(`dev-${mark}`), [['글', 'posts']]);

    await newApp(`mag-${mark}`, { kind: 'magazine' });
    assert.deepEqual(await menus(`mag-${mark}`), [['호', 'issues']]);
    await newApp(`food-${mark}`, { menus: ['레시피', '맛집'] });
    assert.deepEqual(await menus(`food-${mark}`), [
      ['레시피', 'posts'],
      ['맛집', 'posts'],
    ]);

    const listed = (ok(await api.get('/api/apps', owner)).apps as Json[]).find(
      (a) => a.id === made.id,
    );
    assert.deepEqual(listed?.counts, { published: 0, drafts: 0, menus: 1, pages: 0 });
  });

  test('비공개 앱은 방문자 · write 기기에게 목록 · 머리 · 아이콘 어디에도 없다 (404)', async () => {
    const app = await newApp(`hidden-${mark}`);
    for (const headers of [{}, writer]) {
      const seen = ok(await api.request('GET', '/api/apps', TestUser.visitor, undefined, headers));
      assert.equal(
        (seen.apps as Json[]).some((a) => a.slug === app.slug),
        false,
      );
      for (const path of [`/api/apps/by-slug/${app.slug}`, `/api/apps/by-slug/${app.slug}/icon`])
        assert.equal(
          (await api.request('GET', path, TestUser.visitor, undefined, headers)).status,
          404,
        );
    }
    assert.equal((await api.get(`/api/apps/by-slug/${app.slug}`, owner)).status, 200);
  });

  test('공개로 바꾸면 방문자도 본다 (id · 공개 여부는 싣지 않는다). 낡은 version은 409', async () => {
    const app = await newApp(`open-${mark}`, { description: '공개할 앱' });
    const opened = await setVisibility(app, 'public');
    const seen = ok(await api.get(`/api/apps/by-slug/${app.slug}`));
    assert.deepEqual(seen, {
      kind: 'blog',
      name: app.name,
      slug: app.slug,
      description: '공개할 앱',
      iconUrl: null,
      home: false,
    });
    const listed = (ok(await api.get('/api/apps')).apps as Json[]).find((a) => a.slug === app.slug);
    assert.deepEqual(listed, seen);
    const stale = await api.request('PATCH', `/api/apps/${app.id}`, owner, {
      version: app.version,
      name: '늦은 고침',
    });
    assert.equal(stale.status, 409);
    assert.equal(opened.version, Number(app.version) + 1);
  });

  test('방문자와 write 기기는 만들지도 고치지도 지우지도 못한다 (403)', async () => {
    const app = await newApp(`guard-${mark}`);
    for (const headers of [{}, writer]) {
      const as = TestUser.visitor;
      const body = { kind: 'blog', name: '막힘', slug: `no-${mark}` };
      assert.equal((await createApp(body, as, headers)).status, 403);
      const edit = { version: app.version, visibility: 'public' };
      assert.equal(
        (await api.request('PATCH', `/api/apps/${app.id}`, as, edit, headers)).status,
        403,
      );
      const del = { version: app.version };
      assert.equal(
        (await api.request('POST', `/api/apps/${app.id}/delete`, as, del, headers)).status,
        403,
      );
    }
  });

  test('주소: 형식 · 못 쓰는 이름은 422, 겹치면 409. 종류가 틀리면 422, 페이지 앱은 페이지가 있어야 한다', async () => {
    for (const slug of ['A', 'x', 'has space', '한글', '-dash', 'admin', 'posts', 'api'])
      assert.equal((await createApp({ kind: 'blog', name: '틀림', slug })).status, 422, slug);
    await newApp(`taken-${mark}`);
    assert.equal(
      (await createApp({ kind: 'blog', name: '겹침', slug: `taken-${mark}` })).status,
      409,
    );
    assert.equal((await createApp({ kind: 'shop', name: '종류', slug: `k-${mark}` })).status, 422);
    const page = await createApp({ kind: 'page', name: '지도', slug: `map-${mark}` });
    assert.equal(page.status, 422);
    assert.match(page.text, /페이지가 있어야/);
  });

  test('비공개 앱의 글 · 메뉴 · 호는 방문자에게 없는 것과 같다. 공개로 바꾸면 보인다', async () => {
    const app = await newApp(`travel-${mark}`, { menus: ['일기'] });
    const post = await publicPost(app.id, `여행 글 ${mark}`);
    const visible = async () => ({
      list: (ok(await api.get(`/api/posts?app=${app.slug}`)).posts as Json[]).length,
      all: (ok(await api.get('/api/posts')).posts as Json[]).some((p) => p.slug === post.slug),
      page: (await api.get(`/api/posts/by-slug/${encodeURIComponent(String(post.slug))}`)).status,
      menus: (ok(await api.get(`/api/menus?app=${app.slug}`)).menus as Json[]).length,
    });
    assert.deepEqual(await visible(), { list: 0, all: false, page: 404, menus: 0 });
    await setVisibility(app, 'public');
    assert.deepEqual(await visible(), { list: 1, all: true, page: 200, menus: 1 });
    const shown = ok(await api.get(`/api/posts/by-slug/${encodeURIComponent(String(post.slug))}`));
    assert.deepEqual(shown.app, { slug: app.slug, name: app.name });
  });

  test('글을 다른 앱으로: 메뉴를 주면 그 메뉴의 앱, 앱만 주면 메뉴에서 빠진다. 앱 없는 글은 공개 422', async () => {
    const [a, b] = [await newApp(`a-${mark}`), await newApp(`b-${mark}`)];
    const [menuB] = ok(await api.get(`/api/menus?app=${b.slug}`, owner)).menus as Json[];
    const loose = ok(
      await api.request('POST', '/api/posts', owner, { requestId: randomUUID(), title: '앱 밖' }),
      201,
    );
    assert.equal(loose.appId, null);
    const refused = await api.request('POST', `/api/posts/${loose.id}/status`, owner, {
      version: loose.version,
      status: 'published',
    });
    assert.equal(refused.status, 422);
    assert.match(refused.text, /앱에 넣은 뒤 공개해요/);

    const inA = ok(
      await api.request('POST', `/api/posts/${loose.id}/menu`, owner, {
        version: loose.version,
        menuId: null,
        appId: a.id,
      }),
    );
    assert.deepEqual([inA.appId, inA.menuId], [a.id, null]);
    const inB = ok(
      await api.request('POST', `/api/posts/${loose.id}/menu`, owner, {
        version: inA.version,
        menuId: menuB?.id,
      }),
    );
    assert.deepEqual([inB.appId, inB.menuId], [b.id, menuB?.id], '메뉴를 주면 그 메뉴의 앱');
  });

  test('아이콘: 관리자만 그림만 올린다. 공개 앱이면 누구나 보고, 지우면 404', async () => {
    let app = await newApp(`icon-${mark}`);
    assert.equal((await putIcon(app, png(), 'image/png', TestUser.visitor)).status, 403);
    assert.equal((await putIcon(app, '<svg/>', 'image/svg+xml')).status, 415);
    app = ok(await putIcon(app, png(), 'image/png'));
    assert.match(String(app.iconUrl), new RegExp(`^/api/apps/by-slug/${app.slug}/icon\\?v=`));
    assert.equal((await api.get(`/api/apps/by-slug/${app.slug}/icon`)).status, 404, '비공개');
    app = await setVisibility(app, 'public');
    const icon = await api.get(`/api/apps/by-slug/${app.slug}/icon`);
    assert.equal(icon.status, 200);
    assert.equal(icon.header('content-security-policy'), 'sandbox');
    app = ok(
      await api.request('POST', `/api/apps/${app.id}/icon/delete`, owner, {
        version: app.version,
      }),
    );
    assert.equal(app.iconUrl, null);
    assert.equal((await api.get(`/api/apps/by-slug/${app.slug}/icon`)).status, 404);
  });

  test('지우기: 글이 남아 있으면 409, 비우면 빈 메뉴와 함께 지운다', async () => {
    const app = await newApp(`gone-${mark}`);
    const post = ok(
      await api.request('POST', '/api/posts', owner, {
        requestId: randomUUID(),
        title: '남은 글',
        appId: app.id,
      }),
      201,
    );
    const full = await api.request('POST', `/api/apps/${app.id}/delete`, owner, {
      version: app.version,
    });
    assert.equal(full.status, 409);
    assert.match(full.text, /글 1개/);
    ok(
      await api.request('POST', `/api/posts/${post.id}/menu`, owner, {
        version: post.version,
        menuId: null,
        appId: null,
      }),
    );
    const gone = await api.request('POST', `/api/apps/${app.id}/delete`, owner, {
      version: app.version,
    });
    assert.equal(gone.status, 204, gone.text);
    assert.equal((await api.get(`/api/apps/by-slug/${app.slug}`, owner)).status, 404);
    assert.equal(
      (ok(await api.get(`/api/menus?app=${app.slug}`, owner)).menus as Json[]).length,
      0,
    );
  });
});
