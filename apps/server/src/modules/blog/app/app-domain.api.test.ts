import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, ApiResult, TestUser } from '../../../testing/api-client';
import { Database, HostGate } from '../../platform';

// 앱마다 도메인 (스토어 3-0, docs/스토어.md 11장): 도메인 정하기(관리자) · 앱 도메인으로 온 요청(HostGate) ·
// 연결 확인(/.well-known/moida-domain → domain/check) · 도메인으로 여는 앱 목록 · 화면의 주소 기준과 보내기.
// 도메인은 모든 공간에서 하나이고 테스트 DB를 다른 테스트와 함께 쓰므로 도메인마다 이 실행의 표시를 붙인다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
const mark = randomUUID().slice(0, 8);
const domainOf = (name: string) => `${name}-${mark}.example.com`;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** Host 머리글을 정해 보내는 요청 (앱 도메인). cookie: 관리자 쿠키를 실어 볼 때 */
function viaHost(
  path: string,
  host: string,
  options: { method?: string; cookie?: string; forwarded?: boolean } = {},
): Promise<ApiResult> {
  const { cookie, ...rest } = options;
  return api.viaHost(path, host, { ...rest, headers: cookie ? { cookie } : {} });
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

const patch = (app: Json, body: Json, as = owner, headers: Record<string, string> = {}) =>
  api.request('PATCH', `/api/apps/${app.id}`, as, { version: app.version, ...body }, headers);

/** 도메인을 정하고, 그 도메인의 확인 값을 읽어 연결을 확인한 앱 */
async function linked(app: Json, domain: string): Promise<Json> {
  const set = ok(await patch(app, { domain }));
  const { token } = ok(await viaHost('/.well-known/moida-domain', domain));
  return ok(
    await api.request('POST', `/api/apps/${app.id}/domain/check`, owner, {
      version: set.version,
      token,
    }),
  );
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, `domain-writer-${mark}`)}` };
});
after(() => api.close());

describe('앱 도메인 정하기 (PATCH /api/apps/:id { domain })', () => {
  test('관리자만 정하고, 소문자로 두고, 다른 앱이 쓰는 도메인은 409, 틀린 모양은 422', async () => {
    const app = await newApp(`dom-${mark}`);
    const domain = domainOf('blog');
    assert.equal((await patch(app, { domain }, TestUser.visitor)).status, 403);
    assert.equal((await patch(app, { domain }, TestUser.visitor, writer)).status, 403);

    const set = ok(await patch(app, { domain: `  ${domain.toUpperCase()}.` }));
    assert.deepEqual(
      [set.domain, set.domainCheckedAt, set.url],
      [domain, null, `/dom-${mark}`],
      '확인 전에는 기본 도메인의 주소',
    );

    const other = await newApp(`dom2-${mark}`);
    const taken = await patch(other, { domain });
    assert.equal(taken.status, 409, taken.text);
    assert.match(taken.json().message as string, /다른 앱이 쓰는 도메인/);

    for (const wrong of ['https://x.example.com', 'x.example.com:8080', '127.0.0.1', 'localhost'])
      assert.equal((await patch(other, { domain: wrong })).status, 422, wrong);

    const cleared = ok(await patch(set, { domain: null }));
    assert.equal(cleared.domain, null);
    ok(await patch(other, { domain }), 200);
  });
});

describe('앱 도메인으로 온 요청 (HostGate)', () => {
  let app: Json;
  let domain: string;

  before(async () => {
    app = await newApp(`gate-${mark}`);
    domain = domainOf('gate');
    app = ok(await patch(app, { domain }));
  });

  test('정한 즉시 앱 도메인이 된다: 등록한 경로(GET)만 지나고 관리 API · MCP · OAuth는 없는 주소', async () => {
    for (const path of ['/api/apps', '/api/auth/me', '/api/space', '/mcp', '/oauth/authorize']) {
      const res = await viaHost(path, domain);
      assert.equal(res.status, 404, `${path} ${res.text}`);
      assert.equal(res.json().code, 'not_found');
    }
    // 앞단 프록시가 넘긴 X-Forwarded-Host만 앱 도메인이어도 같다 (대문자 · 포트도)
    const forwarded = await viaHost('/api/apps', `${domain.toUpperCase()}:443`, {
      forwarded: true,
    });
    assert.equal(forwarded.status, 404);
    // 등록한 경로라도 GET · HEAD만
    assert.equal(
      (await viaHost('/.well-known/moida-domain', domain, { method: 'POST' })).status,
      404,
    );
    // 모르는 호스트는 기본 도메인처럼 (개발 · 서버끼리의 이름)
    assert.equal((await viaHost('/api/apps', `unknown-${mark}.example.com`)).status, 200);
  });

  test('앱 도메인에서는 로그인 쿠키가 있어도 방문자다', async () => {
    const icon = `/api/apps/by-slug/gate-${mark}/icon`;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const res = await fetch(`${api.baseUrl}/api/apps/${app.id}/icon?version=${app.version}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', cookie: owner.header ?? '' },
      body: png,
    });
    assert.equal(res.status, 200);
    app = (await res.json()) as Json;
    assert.equal((await api.get(icon, owner)).status, 200, '기본 도메인의 관리자는 비공개 앱도');
    const onDomain = await viaHost(icon, domain, { cookie: owner.header ?? '' });
    assert.equal(onDomain.status, 404, '앱 도메인에서는 방문자: 비공개 앱은 없다');
  });

  test('/.well-known/moida-domain: 앱 도메인에서만 값을 주고, 사이트 주소의 출처만 읽게 한다', async () => {
    assert.equal((await api.get('/.well-known/moida-domain')).status, 404, '기본 도메인');
    const proof = await viaHost('/.well-known/moida-domain', domain);
    assert.equal(proof.status, 200, proof.text);
    assert.match(String(proof.json().token), /^[\w-]{40,}$/);
    // 출처는 사이트에서 온 요청에만 알려 준다: GET 한 번으로 콘솔이 있는 사이트를 알아내지 못하게 (2026-11-25)
    assert.equal(proof.header('access-control-allow-origin'), null, 'Origin 없는 요청');
    const other = await api.viaHost('/.well-known/moida-domain', domain, {
      headers: { origin: 'https://attacker.example' },
    });
    assert.equal(other.header('access-control-allow-origin'), null, '다른 출처');
    const site = new URL(api.baseUrl).origin;
    const fromSite = await api.viaHost('/.well-known/moida-domain', domain, {
      headers: { origin: site },
    });
    assert.equal(fromSite.header('access-control-allow-origin'), site, '사이트 화면이 읽을 때');
    assert.equal(fromSite.header('vary'), 'Origin');
    const again = await viaHost('/.well-known/moida-domain', domain, { forwarded: true });
    assert.equal(again.json().token, proof.json().token, '같은 앱 · 도메인이면 같은 값');
  });
});

describe('연결 확인 (POST /api/apps/:id/domain/check)', () => {
  test('그 도메인에서 읽은 값이면 확인한 때를 적고 주소가 도메인이 된다. 틀린 값 · 관리자 아님은 막는다', async () => {
    const app = await newApp(`check-${mark}`);
    const domain = domainOf('check');
    const set = ok(await patch(app, { domain }));
    const check = (token: string, as = owner, version = set.version) =>
      api.request('POST', `/api/apps/${app.id}/domain/check`, as, { version, token });

    const wrong = await check('not-the-token');
    assert.equal(wrong.status, 422);
    assert.match(wrong.json().message as string, /연결되지 않은 도메인/);
    // 다른 앱 도메인의 값은 이 앱 · 도메인의 값이 아니다
    const elsewhere = await newApp(`check2-${mark}`);
    ok(await patch(elsewhere, { domain: domainOf('check2') }));
    const otherToken = ok(await viaHost('/.well-known/moida-domain', domainOf('check2'))).token;
    assert.equal((await check(String(otherToken))).status, 422);

    const { token } = ok(await viaHost('/.well-known/moida-domain', domain));
    assert.equal((await check(String(token), TestUser.visitor)).status, 403);
    const done = ok(await check(String(token)));
    assert.ok(done.domainCheckedAt, '확인한 때');
    assert.equal(done.url, `https://${domain}/`);
    assert.equal(
      (await check(String(token), owner, set.version as number)).status,
      409,
      '낡은 버전',
    );

    const moved = ok(await patch(done, { domain: domainOf('check3') }));
    assert.deepEqual(
      [moved.domainCheckedAt, moved.url],
      [null, `/check-${mark}`],
      '바꾸면 다시 확인',
    );
  });
});

describe('도메인으로 여는 앱과 화면 (GET /api/apps/domains, screen?host=)', () => {
  test('공개 앱의 확인한 도메인만 목록에 있고, 기본 도메인의 화면은 그 도메인으로 보낸다', async () => {
    const shop = await linked(await newApp(`shop-${mark}`), domainOf('shop'));
    const hidden = await linked(await newApp(`hidden-${mark}`), domainOf('hidden'));
    const waiting = await newApp(`wait-${mark}`);
    ok(await patch(waiting, { domain: domainOf('wait') }));
    const shown = ok(await patch(shop, { visibility: 'public' }));
    const waitingShown = ok(await api.get('/api/apps/by-slug/' + `wait-${mark}`, owner));
    ok(await patch(waitingShown, { visibility: 'public' }));

    const listed = (ok(await api.get('/api/apps/domains')).domains as Json[]).filter((d) =>
      String(d.domain).includes(mark),
    );
    assert.deepEqual(listed, [{ domain: domainOf('shop'), slug: `shop-${mark}` }]);
    assert.ok(hidden.domainCheckedAt, '비공개 앱은 확인했어도 목록에 없다');

    const screen = (query: string) => api.get(`/api/apps/site/shop-${mark}/screen?${query}`);
    // 기본 도메인(사이트 주소의 호스트)으로 열면 그 도메인의 같은 경로로 (308)
    assert.deepEqual(ok(await screen('host=127.0.0.1&path=posts/hello&cursor=c1')), {
      redirect: `https://${domainOf('shop')}/posts/hello?cursor=c1`,
      permanent: true,
    });
    // 그 도메인으로 열면 도메인의 뿌리가 앱 주소
    const own = ok(await screen(`host=${domainOf('shop')}`));
    const data = own.data as Json;
    assert.deepEqual([data.base, data.files], ['/', '/files']);
    assert.equal((data.app as Json).url, '/');
    assert.match(String((data.site as Json).home), /^http:\/\/127\.0\.0\.1:\d+\/$/);
    // host를 보내지 않으면 지금처럼 (보내기 없음)
    assert.equal((ok(await screen('')).data as Json).base, `/shop-${mark}`);
    // 공개 앱 목록의 주소도 도메인으로
    const apps = ok(await api.get('/api/apps')).apps as Json[];
    assert.equal(apps.find((a) => a.slug === `shop-${mark}`)?.url, `https://${domainOf('shop')}/`);
    assert.equal(apps.find((a) => a.slug === `wait-${mark}`)?.url, `/wait-${mark}`);
    assert.ok(shown.domainCheckedAt);
  });
});

describe('커뮤니티 앱의 공개와 화면 (스토어 3-2)', () => {
  test('연결을 확인한 도메인이 있어야 공개되고, 공개 중에는 도메인을 바꾸지 않는다', async () => {
    let town = await newApp(`town-${mark}`, 'community');
    const plain = await patch(town, { visibility: 'public' });
    assert.equal(plain.status, 422, plain.text);
    assert.match(plain.json().message as string, /도메인 연결을 확인한 뒤에 공개/);
    town = ok(await patch(town, { domain: domainOf('town') }));
    assert.equal((await patch(town, { visibility: 'public' })).status, 422, '확인 전');

    town = ok(await patch(await linked(town, domainOf('town')), { visibility: 'public' }));
    assert.equal(town.visibility, 'public');
    for (const domain of [domainOf('town2'), null]) {
      const moved = await patch(town, { domain });
      assert.equal(moved.status, 422, moved.text);
      assert.match(moved.json().message as string, /비공개로 바꾼 뒤에 도메인을/);
    }
    // 비공개로 두면 도메인을 바꿀 수 있다 (확인은 비워진다)
    town = ok(await patch(town, { visibility: 'private' }));
    const moved = ok(await patch(town, { domain: domainOf('town2') }));
    assert.equal(moved.domainCheckedAt, null);
    // 블로그 앱은 그대로 도메인 없이 공개된다
    ok(await patch(await newApp(`plainblog-${mark}`), { visibility: 'public' }));
  });

  test('화면: 첫 화면은 index.html, 글은 t/<글 id> → topic.html, 그 밖의 주소는 404.html', async () => {
    const club = ok(
      await patch(await linked(await newApp(`club-${mark}`, 'community'), domainOf('club')), {
        visibility: 'public',
      }),
    );
    const screen = (path: string) =>
      api.get(
        `/api/apps/site/${club.slug}/screen?${new URLSearchParams({ host: domainOf('club'), path })}`,
      );
    const home = ok(await screen(''));
    assert.deepEqual([home.status, home.template], [200, 'index.html']);
    const templates = home.templates as Record<string, string>;
    for (const name of ['index.html', 'topic.html', 'header.html', '404.html'])
      assert.ok(templates[name], `${name} (${Object.keys(templates).join()})`);
    assert.equal((home.data as Json).isHome, true);

    const id = '01970000-0000-7000-8000-000000000000';
    const topic = ok(await screen(`t/${id}`));
    assert.deepEqual([topic.status, topic.template], [200, 'topic.html']);
    assert.deepEqual([(topic.data as Json).isTopic, (topic.data as Json).screen], [true, 'topic']);

    for (const path of ['t/not-an-id', `t/${id}/more`, 'posts/hello', 'm/posts']) {
      const missing = ok(await screen(path));
      assert.deepEqual([missing.status, missing.template], [404, '404.html'], path);
    }
  });
});

describe('사이트 주소의 도메인 (2026-11-25)', () => {
  test('앱에 사이트 주소와 같은 도메인이 남아 있어도 앱 도메인 목록에 없다: 웹이 콘솔까지 그 앱으로 넘기지 않게', async () => {
    // 정하는 길(PATCH)은 사이트 주소의 도메인을 422로 막는다. 사이트 주소를 정하기 전에 연결한 도메인처럼 DB에 바로 둔다
    const site = domainOf('site');
    const space = ok(await api.get('/api/space', owner));
    const gate = api.service(HostGate);
    const setSite = async (siteUrl: unknown) => {
      const now = ok(await api.get('/api/space', owner));
      ok(
        await api.request('PUT', '/api/space', owner, {
          name: now.name,
          siteUrl,
          version: now.version,
        }),
      );
      gate.stale();
    };
    const app = ok(await patch(await newApp(`site-${mark}`), { visibility: 'public' }));
    const appId = String(app.id);
    const db = api.service(Database);
    await setSite(`https://${site}`);
    await db.sql`UPDATE blog.apps SET domain = ${site}, domain_checked_at = now() WHERE id = ${appId}`;
    try {
      const listed = ok(await api.get('/api/apps/domains')).domains as Json[];
      assert.equal(
        listed.some((d) => d.domain === site),
        false,
      );
    } finally {
      await db.sql`UPDATE blog.apps SET domain = NULL, domain_checked_at = NULL WHERE id = ${appId}`;
      await setSite(space.siteUrl ?? null);
    }
  });
});
