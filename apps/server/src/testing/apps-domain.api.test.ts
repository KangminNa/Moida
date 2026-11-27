import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from './api-client';
import { CommunitySite } from './community-site';

// 공통 앱 도메인 (2026-11-27, 기획서 결정 "apps.moida.ai.kr"): CAIRN_APPS_URL의 호스트로 온 요청은 앱 도메인처럼 등록한 경로만 지나고,
// 앱은 웹이 경로의 첫 칸에서 읽어 x-cairn-app 머리글로 알린다. 그 도메인으로 연 공개 화면은 격리를 풀고(open),
// 계정 하나로 로그인하면 그 도메인의 모든 앱에 같은 쿠키로 참여한다. 자기 도메인 앱 · 기본 도메인은 지금 그대로

const APPS = 'apps.example.com';
const mark = randomUUID().slice(0, 8);
let api: ApiClient;
let owner: TestUser;
const apps: { id: string; slug: string }[] = [];

/** 공통 도메인으로 보내는 요청. app이 있으면 그 앱 (웹이 경로에서 읽어 붙이는 머리글), 쓰기에는 Origin */
function shared(
  path: string,
  app: string | null,
  options: { method?: string; as?: TestUser; body?: object; headers?: Record<string, string> } = {},
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

/** 도메인 없이 공개한, 회원을 받는 페이지 앱 하나 (앱의 약관도 공개) */
async function sharedApp(slug: string): Promise<{ id: string; slug: string }> {
  const made = await api.request('POST', '/api/apps', owner, {
    requestId: randomUUID(),
    kind: 'page',
    name: `공통 ${slug}`,
    slug,
  });
  assert.equal(made.status, 201, made.text);
  const id = String(made.json().id);
  const app = await new CommunitySite.Probe(api, id).deploy(owner, { members: true });
  for (const kind of ['terms', 'privacy']) {
    const res = await api.request('POST', `/api/community/admin/${id}/terms/${kind}`, owner, {
      version: 0,
      body: `# ${kind}\n\n테스트 약관`,
    });
    assert.equal(res.status, 201, res.text);
  }
  const opened = await api.request('PATCH', `/api/apps/${id}`, owner, {
    version: app.version,
    visibility: 'public',
  });
  assert.equal(opened.status, 200, opened.text);
  return { id, slug };
}

before(async () => {
  process.env.CAIRN_APPS_URL = `http://${APPS}`;
  api = await ApiClient.start();
  owner = await api.signIn();
  CommunitySite.mailbox(api);
  // 공통 약관(스토어)은 다른 앱을 여는 도우미가 공개한다
  await CommunitySite.openPage(api, owner, `own-${mark}`, { members: true });
  apps.push(await sharedApp(`one-${mark}`), await sharedApp(`two-${mark}`));
});
after(async () => {
  delete process.env.CAIRN_APPS_URL;
  await api.close();
});

describe('공통 앱 도메인', () => {
  test('그 도메인으로 연 공개 화면은 격리를 풀고 앱은 /<앱> 아래에 있다. 기본 도메인은 격리 그대로', async () => {
    const [one] = apps;
    const screen = async (host: string) =>
      (await api.get(`/api/apps/site/${one?.slug}/screen?path=&host=${host}`)).json() as {
        open: boolean;
      };
    assert.equal((await screen(APPS)).open, true);
    assert.equal((await screen('localhost')).open, false);
  });

  test('관리 API · 콘솔 경로는 없는 주소, 앱 없이도 스토어 가입 · 공통 약관은 열린다', async () => {
    const [one] = apps;
    assert.equal((await shared('/api/auth/me', one?.slug ?? null, { as: owner })).status, 404);
    assert.equal(
      (await shared(`/api/community/admin/${one?.id}/data`, null, { as: owner })).status,
      404,
    );
    assert.equal((await shared('/api/store/terms/terms', null)).status, 200);
    // 앱을 알리지 않은 회원 API는 어느 앱인지 몰라 없는 주소
    assert.equal((await shared('/api/community/me', null)).status, 404);
    assert.equal((await shared('/api/community/me', 'no-such-app')).status, 404);
  });

  test('한 번 로그인하면 같은 쿠키로 공통 도메인의 다른 앱에도 참여한다', async () => {
    const [one, two] = apps as unknown as [{ slug: string }, { slug: string }];
    const email = CommunitySite.emailOf(`shared_${mark}`);
    const sent = await shared('/api/community/join/code', one.slug, {
      method: 'POST',
      body: { email },
    });
    assert.equal(sent.status, 204, `${sent.status} ${sent.text}`);
    const code = CommunitySite.mailbox(api).codeFor(email);
    const joined = await shared('/api/community/join', one.slug, {
      method: 'POST',
      body: {
        email,
        code,
        nickname: '공통회원',
        password: CommunitySite.PASSWORD,
        ageConfirmed: true,
        loginId: CommunitySite.loginIdOf(email),
        ...CommunitySite.AGREED,
      },
    });
    assert.equal(joined.status, 201, joined.text);
    const member = new TestUser(joined.cookies());
    const meOne = (await shared('/api/community/me', one.slug, { as: member })).json() as {
      member: { nickname: string } | null;
    };
    assert.equal(meOne.member?.nickname, '공통회원');

    // 두 번째 앱: 같은 쿠키라 로그인은 되어 있고, 참여만 하면 된다
    const meTwo = (await shared('/api/community/me', two.slug, { as: member })).json() as {
      account: unknown;
      member: unknown;
      csrf: string;
    };
    assert.ok(meTwo.account, '같은 도메인의 쿠키라 계정이 보인다');
    assert.equal(meTwo.member, null, '아직 이 앱에는 참여 전');
    const { termsVersion, privacyVersion, ...agreed } = CommunitySite.AGREED;
    const entered = await shared('/api/community/enter', two.slug, {
      method: 'POST',
      as: member,
      body: { nickname: '두번째앱', ...agreed },
      headers: { 'x-cairn-csrf': String(meTwo.csrf) },
    });
    assert.equal(entered.status, 201, entered.text);
    assert.equal(
      (
        (await shared('/api/community/me', two.slug, { as: member })).json() as {
          member: { nickname: string } | null;
        }
      ).member?.nickname,
      '두번째앱',
    );
  });
});
