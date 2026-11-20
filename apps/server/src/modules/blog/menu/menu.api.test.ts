import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';

// /api/menus (2차 6단계): 메뉴 줄은 누구나(이름 · 주소 · 종류만), 설정과 쓰기는 관리자만.
// 운영 팀은 비공개를 읽지 않는 에이전트만, 안이 비어야 지운다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
/** write 권한을 준 기기의 Bearer 머리글. 관리 일은 이 기기에게도 막혀야 한다 */
let writer: Readonly<Record<string, string>>;
/** 메뉴를 둘 공개 앱 (스토어 1단계: 메뉴는 앱 하나에 든다) */
let app: string;
const mark = randomUUID().slice(0, 6);

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const create = (body: Json, as = owner, headers: Record<string, string> = {}) =>
  api.request('POST', '/api/menus', as, { requestId: randomUUID(), appId: app, ...body }, headers);

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  app = await api.blogApp(owner);
  writer = { authorization: `Bearer ${await api.writeDevice(owner, `menu-writer-${mark}`)}` };
});
after(() => api.close());

describe('메뉴 (/api/menus)', () => {
  test('관리자가 만들면(같은 requestId는 한 번) 방문자는 메뉴 줄에서 이름 · 주소 · 종류만 본다', async () => {
    const requestId = randomUUID();
    const body = {
      requestId,
      appId: app,
      kind: 'posts',
      name: `에세이 ${mark}`,
      policy: '일기 말투로',
      sort: 5,
    };
    const made = ok(await api.request('POST', '/api/menus', owner, body), 201);
    const again = ok(await api.request('POST', '/api/menus', owner, body), 201);
    assert.equal(again.id, made.id, '같은 requestId는 처음 것');
    assert.deepEqual(
      [made.kind, made.slug, made.policy, made.rss, made.sort],
      ['posts', `에세이-${mark}`, '일기 말투로', true, 5],
    );

    const mine = (ok(await api.get('/api/menus', owner)).menus as Json[]).find(
      (m) => m.id === made.id,
    );
    assert.equal(mine?.items, 0);
    for (const headers of [{}, writer]) {
      const seen = ok(await api.request('GET', '/api/menus', TestUser.visitor, undefined, headers));
      const menu = (seen.menus as Json[]).find((m) => m.slug === made.slug);
      assert.deepEqual(menu, {
        app: 'blog',
        name: `에세이 ${mark}`,
        slug: made.slug,
        kind: 'posts',
        rss: true,
      });
    }
  });

  test('방문자와 write 기기는 만들지도 고치지도 지우지도 못한다 (403)', async () => {
    const made = ok(await create({ kind: 'pages', name: `모음 ${mark}` }), 201);
    for (const headers of [{}, writer]) {
      assert.equal(
        (await create({ kind: 'posts', name: '막힘' }, TestUser.visitor, headers)).status,
        403,
      );
      const edit = await api.request(
        'PATCH',
        `/api/menus/${made.id}`,
        TestUser.visitor,
        { version: made.version, name: '바꿈' },
        headers,
      );
      assert.equal(edit.status, 403, edit.text);
      const remove = await api.request(
        'POST',
        `/api/menus/${made.id}/delete`,
        TestUser.visitor,
        { version: made.version },
        headers,
      );
      assert.equal(remove.status, 403, remove.text);
    }
  });

  test('고치기는 version을 맞춰서, 주소가 겹치면 422, 종류 · 이름 · 주소의 모양이 틀리면 422 · 400', async () => {
    const made = ok(
      await create({ kind: 'posts', name: `기록 ${mark}`, slug: `log-${mark}` }),
      201,
    );
    const changed = ok(
      await api.request('PATCH', `/api/menus/${made.id}`, owner, {
        version: made.version,
        name: `작업 기록 ${mark}`,
        policy: '',
        rss: false,
      }),
    );
    assert.deepEqual(
      [changed.name, changed.slug, changed.policy, changed.rss],
      [`작업 기록 ${mark}`, `log-${mark}`, '', false],
    );
    const stale = await api.request('PATCH', `/api/menus/${made.id}`, owner, {
      version: made.version,
      name: '늦음',
    });
    assert.equal(stale.status, 409, stale.text);
    assert.equal(
      (await create({ kind: 'posts', name: '같은 주소', slug: `log-${mark}` })).status,
      422,
    );
    assert.equal((await create({ kind: 'magazine', name: '종류' })).status, 422);
    assert.equal((await create({ kind: 'posts', name: 'x'.repeat(41) })).status, 422);
    assert.equal((await create({ kind: 'posts', name: '주소', slug: 'a b!' })).status, 422);
    assert.equal((await create({ name: '종류 없음' })).status, 400);
  });

  test('운영 팀은 이 공간의, 비공개를 읽지 않는 에이전트만 (422 · 404)', async () => {
    const reader = ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: `다 읽는 ${mark}`,
        tool: 'claude',
        scopes: ['read_all', 'write'],
      }),
      201,
    );
    const writerAgent = ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: `쓰는 ${mark}`,
        tool: 'claude',
        scopes: ['read_public', 'write'],
      }),
      201,
    );
    const refused = await create({ kind: 'posts', name: `팀 ${mark}`, agentId: reader.id });
    assert.equal(refused.status, 422, refused.text);
    assert.match(refused.text, /비공개를 읽는 에이전트/);
    assert.equal(
      (await create({ kind: 'posts', name: `팀 ${mark}`, agentId: randomUUID() })).status,
      404,
    );
    const team = ok(
      await create({ kind: 'posts', name: `팀 ${mark}`, agentId: writerAgent.id }),
      201,
    );
    assert.equal(team.agentId, writerAgent.id);
    const cleared = ok(
      await api.request('PATCH', `/api/menus/${team.id}`, owner, {
        version: team.version,
        agentId: null,
      }),
    );
    assert.equal(cleared.agentId, null);
  });

  test('빈 메뉴는 지우고, 낡은 version은 409', async () => {
    const made = ok(await create({ kind: 'page', name: `소개 ${mark}` }), 201);
    const stale = await api.request('POST', `/api/menus/${made.id}/delete`, owner, {
      version: Number(made.version) + 1,
    });
    assert.equal(stale.status, 409, stale.text);
    const gone = await api.request('POST', `/api/menus/${made.id}/delete`, owner, {
      version: made.version,
    });
    assert.equal(gone.status, 204, gone.text);
    const list = ok(await api.get('/api/menus', owner)).menus as Json[];
    assert.equal(
      list.some((m) => m.id === made.id),
      false,
    );
  });

  test('글을 메뉴에 올리면 공개 대기, 공개한 글만 방문자의 메뉴 목록에. 받지 않는 메뉴는 422, 방문자는 403', async () => {
    const menu = ok(
      await create({ kind: 'posts', name: `일기 ${mark}`, slug: `diary-${mark}` }),
      201,
    );
    const pages = ok(await create({ kind: 'pages', name: `페이지들 ${mark}` }), 201);
    const post = ok(
      await api.request('POST', '/api/posts', owner, {
        appId: await api.blogApp(owner),
        requestId: randomUUID(),
        title: `메뉴 글 ${mark}`,
        body: '본문',
      }),
      201,
    );
    const wrong = await api.request('POST', `/api/posts/${post.id}/menu`, owner, {
      version: post.version,
      menuId: pages.id,
    });
    assert.equal(wrong.status, 422, wrong.text);
    for (const headers of [{}, writer]) {
      const denied = await api.request(
        'POST',
        `/api/posts/${post.id}/menu`,
        TestUser.visitor,
        { version: post.version, menuId: menu.id },
        headers,
      );
      assert.equal(denied.status, 403, denied.text);
    }
    const placed = ok(
      await api.request('POST', `/api/posts/${post.id}/menu`, owner, {
        version: post.version,
        menuId: menu.id,
      }),
    );
    assert.equal(placed.menuId, menu.id);
    const inMenu = async () =>
      (
        ok(await api.get(`/api/posts?menu=${encodeURIComponent(String(menu.slug))}`))
          .posts as Json[]
      ).map((p) => p.slug);
    assert.deepEqual(await inMenu(), [], '공개 대기: 아직 보이지 않는다');
    ok(
      await api.request('POST', `/api/posts/${post.id}/status`, owner, {
        version: placed.version,
        status: 'published',
      }),
    );
    assert.deepEqual(await inMenu(), [post.slug]);
    const library = (ok(await api.get('/api/library?kind=post', owner)).items as Json[]).find(
      (i) => i.id === post.id,
    );
    assert.deepEqual([library?.placeId, library?.place], [menu.id, `일기 ${mark}`]);
    const busy = await api.request('POST', `/api/menus/${menu.id}/delete`, owner, {
      version: menu.version,
    });
    assert.equal(busy.status, 422, '글이 있는 메뉴는 지우지 못한다');
  });

  test('AI 도구: blog_menus로 편집 방침을 읽고, blog_save_draft의 menu_id로 초안을 메뉴에 올린다', async () => {
    const menu = ok(
      await create({ kind: 'posts', name: `AI 글 ${mark}`, policy: '짧게 세 문단으로' }),
      201,
    );
    const token = String(writer.authorization).slice('Bearer '.length);
    const call = async (name: string, args: Json) => {
      const res = await api.mcp(token, 'tools/call', { name, arguments: args });
      const result = res.json().result as { isError?: boolean; structuredContent?: Json };
      assert.ok(result && !result.isError, res.text);
      return result.structuredContent ?? {};
    };
    const menus = (await call('blog_menus', {})).menus as Json[];
    assert.equal(menus.find((m) => m.id === menu.id)?.policy, '짧게 세 문단으로');
    const saved = await call('blog_save_draft', {
      request_id: randomUUID(),
      title: `AI 초안 ${mark}`,
      body_md: '본문',
      menu_id: menu.id,
    });
    assert.equal(saved.menu_id, menu.id);
    assert.deepEqual((await call('blog_menus', {})).recent_posts, [], '모든 앱이면 최근 글 없음');

    // 한 앱을 고르면 그 앱의 최근 공개 글 (문체 프로필, 2026-11-20). 초안은 빠진다
    const recent = async () =>
      ((await call('blog_menus', { app_id: app })).recent_posts as Json[]).map((p) => p.id);
    assert.equal((await recent()).includes(saved.post_id), false, '초안은 빠진다');
    ok(
      await api.request('POST', `/api/posts/${saved.post_id}/status`, owner, {
        version: saved.version,
        status: 'published',
      }),
    );
    const ids = await recent();
    assert.equal(ids[0], saved.post_id, '가장 새로 공개한 글이 먼저');
    assert.ok(ids.length <= 10);
  });
});
