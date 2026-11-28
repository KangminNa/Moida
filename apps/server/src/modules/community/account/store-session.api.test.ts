import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';

// 앱 없는 로그인 (2026-11-27, api/store/login · logout · me): 공통 앱 도메인에서만. 그 로그인은 그 도메인의 모든 앱에서 통하고
// 앱마다의 도메인에서는 통하지 않는다. 기본 도메인 · 앱 도메인에는 없는 주소

const APPS = 'apps.example.com';
const mark = randomUUID().slice(0, 8);
let api: ApiClient;
let owner: TestUser;
let own: CommunitySite;
let slug: string;
const email = CommunitySite.emailOf(`store_${mark}`);

function shared(
  path: string,
  options: { method?: string; as?: TestUser; body?: object; headers?: Record<string, string> } = {},
  app: string | null = null,
): Promise<ApiResult> {
  const write = (options.method ?? 'GET') !== 'GET';
  return api.viaHost(path, APPS, {
    ...options,
    headers: {
      ...(app ? { 'x-moida-app': app } : {}),
      ...(write ? { origin: `http://${APPS}`, 'x-forwarded-for': CommunitySite.nextPlace() } : {}),
      ...options.headers,
    },
  });
}

before(async () => {
  process.env.MOIDA_APPS_URL = `http://${APPS}`;
  api = await ApiClient.start();
  owner = await api.signIn();
  CommunitySite.mailbox(api);
  own = await CommunitySite.openPage(api, owner, `own-${mark}`, { members: true });
  // 도메인 없이 공개한, 회원을 받는 앱 하나에 가입해 계정을 만든다
  slug = `one-${mark}`;
  const made = await api.request('POST', '/api/apps', owner, {
    requestId: randomUUID(),
    kind: 'page',
    name: '공통 앱',
    slug,
  });
  const id = String(made.json().id);
  const app = await new CommunitySite.Probe(api, id).deploy(owner, { members: true });
  for (const kind of ['terms', 'privacy']) {
    const res = await api.request('POST', `/api/community/admin/${id}/terms/${kind}`, owner, {
      version: 0,
      body: `# ${kind}\n\n테스트 약관`,
    });
    assert.equal(res.status, 201, res.text);
  }
  assert.equal(
    (
      await api.request('PATCH', `/api/apps/${id}`, owner, {
        version: app.version,
        visibility: 'public',
      })
    ).status,
    200,
  );
  assert.equal(
    (await shared('/api/community/join/code', { method: 'POST', body: { email } }, slug)).status,
    204,
  );
  const joined = await shared(
    '/api/community/join',
    {
      method: 'POST',
      body: {
        email,
        code: CommunitySite.mailbox(api).codeFor(email),
        nickname: '앱없는로그인',
        password: CommunitySite.PASSWORD,
        ageConfirmed: true,
        loginId: CommunitySite.loginIdOf(email),
        ...CommunitySite.AGREED,
      },
    },
    slug,
  );
  assert.equal(joined.status, 201, joined.text);
});
after(async () => {
  delete process.env.MOIDA_APPS_URL;
  await api.close();
});

const login = (password = CommunitySite.PASSWORD) =>
  shared('/api/store/login', { method: 'POST', body: { login: email, password } });

describe('앱 없는 로그인', () => {
  test('공통 도메인에서 앱 없이 로그인하면 그 도메인의 앱에서 로그인돼 있다 (회원은 그 앱에 참여한 것)', async () => {
    const res = await login();
    assert.equal(res.status, 200, res.text);
    const member = new TestUser(res.cookies());
    const me = (await shared('/api/store/me', { as: member })).json() as {
      account: { loginId: string } | null;
      member: unknown;
      csrf: string | null;
    };
    assert.equal(me.account?.loginId, CommunitySite.loginIdOf(email));
    assert.equal(me.member, null);
    assert.ok(me.csrf);
    const inApp = (await shared('/api/community/me', { as: member }, slug)).json() as {
      member: { nickname: string } | null;
    };
    assert.equal(inApp.member?.nickname, '앱없는로그인');
    // 같은 쿠키를 앱마다의 도메인에 실어도 그 도메인의 로그인이 아니다
    const there = (await own.at('/api/community/me', { as: member })).json() as {
      account: unknown;
    };
    assert.equal(there.account, null);
  });

  test('틀린 비밀번호는 401, 기본 도메인 · 앱마다의 도메인에는 없는 주소', async () => {
    assert.equal((await login('틀린 비밀번호입니다 정말로')).status, 401);
    assert.equal((await api.get('/api/store/me')).status, 404);
    assert.equal(
      (
        await api.request('POST', '/api/store/login', TestUser.visitor, {
          login: email,
          password: 'x',
        })
      ).status,
      404,
    );
    assert.equal((await own.at('/api/store/me')).status, 404);
  });

  test('로그아웃은 쓰기 확인 값이 있어야 하고, 하면 그 도메인의 로그인이 끝난다', async () => {
    const member = new TestUser((await login()).cookies());
    const { csrf } = (await shared('/api/store/me', { as: member })).json() as { csrf: string };
    assert.equal((await shared('/api/store/logout', { method: 'POST', as: member })).status, 403);
    const out = await shared('/api/store/logout', {
      method: 'POST',
      as: member,
      headers: { 'x-moida-csrf': csrf },
    });
    assert.equal(out.status, 204, out.text);
    assert.equal(
      ((await shared('/api/store/me', { as: member })).json() as { account: unknown }).account,
      null,
    );
  });

  test('다른 출처에서 온 로그인은 403', async () => {
    const res = await shared('/api/store/login', {
      method: 'POST',
      body: { login: email, password: CommunitySite.PASSWORD },
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
  });
});
