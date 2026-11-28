import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';

// 앱 없는 계정 일 (2026-11-28, api/store/password/… · me/password · account/news · account/leave): 공통 앱 도메인에서만.
// 앱의 같은 API와 규칙이 같고, 로그인이 필요한 것은 그 도메인의 앱 없는 로그인으로 한다. 기본 도메인 · 앱마다의 도메인에는 없는 주소

const APPS = 'apps.example.com';
const mark = randomUUID().slice(0, 8);
let api: ApiClient;
let owner: TestUser;
let own: CommunitySite;
let slug: string;
const email = CommunitySite.emailOf(`storeacc_${mark}`);

function shared(
  path: string,
  options: { method?: string; as?: TestUser; body?: object; headers?: Record<string, string> } = {},
  app: string | null = null,
): Promise<ApiResult> {
  const write = (options.method ?? 'GET') !== 'GET';
  return api.viaHost(path, APPS, {
    ...options,
    headers: {
      ...(app ? { 'x-cairn-app': app } : {}),
      ...(write ? { origin: `http://${APPS}`, 'x-forwarded-for': CommunitySite.nextPlace() } : {}),
      ...options.headers,
    },
  });
}

before(async () => {
  process.env.CAIRN_APPS_URL = `http://${APPS}`;
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
        nickname: '앱없는계정',
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
  delete process.env.CAIRN_APPS_URL;
  await api.close();
});

let password = CommunitySite.PASSWORD;

/** 앱 없이 로그인한 브라우저와 그 쓰기 확인 값 */
async function signedIn(): Promise<{ who: TestUser; csrf: string }> {
  const res = await shared('/api/store/login', {
    method: 'POST',
    body: { login: email, password },
  });
  assert.equal(res.status, 200, res.text);
  const who = new TestUser(res.cookies());
  const { csrf } = (await shared('/api/store/me', { as: who })).json() as { csrf: string };
  return { who, csrf };
}

type Self = { version: number; newsMail: boolean; email: string | null } | null;

async function meOf(who: TestUser): Promise<Self> {
  return ((await shared('/api/store/me', { as: who })).json() as { account: Self }).account;
}

describe('앱 없는 계정 일', () => {
  test('기본 도메인 · 앱마다의 도메인에는 없는 주소, 로그인 없이 내 정보 쓰기는 401', async () => {
    const code = { email };
    assert.equal(
      (await api.request('POST', '/api/store/password/code', TestUser.visitor, code)).status,
      404,
    );
    assert.equal(
      (await own.at('/api/store/password/code', { method: 'POST', body: code })).status,
      404,
    );
    const news = await shared('/api/store/account/news', {
      method: 'PUT',
      body: { version: 1, agreed: true },
    });
    assert.equal(news.status, 401, news.text);
  });

  test('메일 코드로 비밀번호를 다시 정하면 앱 없이 연 로그인도 끝나고 새 비밀번호로 로그인한다', async () => {
    const before = await signedIn();
    assert.equal(
      (await shared('/api/store/password/code', { method: 'POST', body: { email } })).status,
      204,
    );
    const mail = CommunitySite.mailbox(api).to(email).at(-1);
    assert.match(mail?.subject ?? '', /비밀번호 다시 정하기/);
    assert.doesNotMatch(mail?.subject ?? '', /공통 앱/); // 앱 없이 받은 메일에는 앱 이름이 없다
    const next = `${CommunitySite.PASSWORD}-새로`;
    const wrong = await shared('/api/store/password/reset', {
      method: 'POST',
      body: { email, code: '000000', password: next },
    });
    assert.equal(wrong.status, 400, wrong.text);
    const reset = await shared('/api/store/password/reset', {
      method: 'POST',
      body: { email, code: CommunitySite.mailbox(api).codeFor(email), password: next },
    });
    assert.equal(reset.status, 204, reset.text);
    password = next;
    assert.equal(await meOf(before.who), null);
    assert.ok(await meOf((await signedIn()).who));
  });

  test('비밀번호 바꾸기는 지금 비밀번호와 쓰기 확인 값이 있어야 하고, 이 브라우저의 로그인은 남는다', async () => {
    const { who, csrf } = await signedIn();
    const other = await signedIn();
    const next = `${CommunitySite.PASSWORD}-또새로`;
    const body = { current: password, next };
    assert.equal(
      (await shared('/api/store/me/password', { method: 'PATCH', as: who, body })).status,
      403,
    );
    const wrong = await shared('/api/store/me/password', {
      method: 'PATCH',
      as: who,
      body: { current: '틀린 비밀번호입니다 정말로', next },
      headers: { 'x-cairn-csrf': csrf },
    });
    assert.equal(wrong.status, 400, wrong.text);
    const done = await shared('/api/store/me/password', {
      method: 'PATCH',
      as: who,
      body,
      headers: { 'x-cairn-csrf': csrf },
    });
    assert.equal(done.status, 204, done.text);
    password = next;
    assert.ok(await meOf(who));
    assert.equal(await meOf(other.who), null);
  });

  test('소식 메일 받기를 켜고 끈다 (본 버전이 낡으면 409)', async () => {
    const { who, csrf } = await signedIn();
    const me = await meOf(who);
    assert.ok(me);
    const put = (version: number, agreed: boolean) =>
      shared('/api/store/account/news', {
        method: 'PUT',
        as: who,
        body: { version, agreed },
        headers: { 'x-cairn-csrf': csrf },
      });
    const on = await put(me.version, !me.newsMail);
    assert.equal(on.status, 200, on.text);
    assert.equal((on.json() as { newsMail: boolean }).newsMail, !me.newsMail);
    assert.equal((await put(me.version, me.newsMail)).status, 409);
  });

  test('계정 탈퇴는 지금 비밀번호가 맞아야 하고, 하면 로그인이 끝나고 다시 로그인할 수 없다', async () => {
    const { who, csrf } = await signedIn();
    const leave = (pw: string) =>
      shared('/api/store/account/leave', {
        method: 'POST',
        as: who,
        body: { password: pw },
        headers: { 'x-cairn-csrf': csrf },
      });
    assert.equal((await leave('틀린 비밀번호입니다 정말로')).status, 400);
    const done = await leave(password);
    assert.equal(done.status, 204, done.text);
    assert.equal(await meOf(who), null);
    const again = await shared('/api/store/login', {
      method: 'POST',
      body: { login: email, password },
    });
    assert.equal(again.status, 401);
  });
});
