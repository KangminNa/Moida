import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';
import { Database, SystemActor, VisitorActor } from '../../platform';
import { AccountQuery } from './account.query';

// 스토어에서 가입 (2026-11-26): 기본 도메인의 가입은 계정만 만들고 로그인하지 않는다 (회원 쿠키 없음).
// 그 계정으로 앱 도메인에 로그인해 닉네임을 정해 참여한다. 앱 도메인에는 이 주소가 없다

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let town: CommunitySite;
const mark = randomUUID().slice(0, 6);
const { termsVersion, privacyVersion } = CommunitySite.AGREED;

/** 기본 도메인에서 한 번의 가입 (코드를 받고, 받지 못하면 code로 준 값) */
async function storeJoin(
  email: string,
  extra: Record<string, unknown> = {},
  ip = CommunitySite.nextPlace(),
): Promise<ApiResult> {
  const box = CommunitySite.mailbox(api);
  const headers = { 'x-forwarded-for': ip };
  const sent = await api.request(
    'POST',
    '/api/store/join/code',
    TestUser.visitor,
    { email },
    headers,
  );
  assert.equal(sent.status, 204, sent.text);
  const known = /이미 가입한/.test(box.to(email).at(-1)?.subject ?? '');
  return api.request(
    'POST',
    '/api/store/join',
    TestUser.visitor,
    {
      email,
      code: known ? '000000' : box.codeFor(email),
      loginId: CommunitySite.loginIdOf(email),
      password: CommunitySite.PASSWORD,
      ageConfirmed: true,
      termsVersion,
      privacyVersion,
      ...extra,
    },
    headers,
  );
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  // 공통 약관 · 회원을 받는 앱 하나 (가입 뒤 로그인할 곳)
  town = await CommunitySite.open(api, owner, `store-join-${mark}`);
});
after(() => api.close());

describe('스토어 가입', () => {
  test('계정만 만들고 로그인하지 않는다 → 앱 도메인에서 로그인해 참여한다', async () => {
    const email = CommunitySite.emailOf(`store${mark}`);
    const joined = await storeJoin(email);
    assert.equal(joined.status, 201, joined.text);
    const body = joined.json() as Json;
    assert.equal(body.email, email);
    assert.equal(body.loginId, CommunitySite.loginIdOf(email));
    assert.deepEqual(joined.cookies(), {}, '기본 도메인에는 회원 쿠키를 두지 않는다');

    const login = await town.at('/api/community/login', {
      method: 'POST',
      body: { login: email, password: CommunitySite.PASSWORD },
      headers: { 'x-forwarded-for': CommunitySite.nextPlace() },
    });
    assert.equal(login.status, 200, login.text);
    const browser = new TestUser(login.cookies());
    const me = (await town.at('/api/community/me', { as: browser })).json() as Json;
    assert.equal((me.account as Json).email, email);
    assert.equal(me.member, null, '앱에는 아직 참여 전');
    assert.deepEqual((me.account as Json).needs, [], '공통 약관은 가입 때 동의했다');
  });

  test('같은 메일은 다시 가입하지 않는다 (코드 대신 안내 메일)', async () => {
    const email = CommunitySite.emailOf(`again${mark}`);
    assert.equal((await storeJoin(email)).status, 201);
    const again = await storeJoin(email);
    assert.equal(again.status, 400, again.text);
    assert.match(CommunitySite.mailbox(api).to(email).at(-1)?.subject ?? '', /이미 가입한/);
  });

  test('틀린 코드 · 동의하지 않은 약관 버전 · 나이 확인 없음은 받지 않는다', async () => {
    const wrong = await storeJoin(CommunitySite.emailOf(`wrong${mark}`), { code: '000000' });
    assert.equal(wrong.status, 400, wrong.text);
    const old = await storeJoin(CommunitySite.emailOf(`old${mark}`), { termsVersion: 999 });
    assert.equal(old.status, 409, old.text);
    const young = await storeJoin(CommunitySite.emailOf(`young${mark}`), { ageConfirmed: false });
    assert.equal(young.status, 422, young.text);
  });

  test('공통 약관은 기본 도메인에서 누구나 읽는다', async () => {
    const terms = await api.request('GET', '/api/store/terms/terms');
    assert.equal(terms.status, 200, terms.text);
    assert.equal((terms.json() as Json).version, termsVersion);
    assert.equal((await api.request('GET', '/api/store/terms/nope')).status, 400);
  });

  test('앱 도메인에는 스토어 가입 주소가 없다 (404)', async () => {
    const res = await town.at('/api/store/join/code', {
      method: 'POST',
      body: { email: CommunitySite.emailOf(`app${mark}`) },
    });
    assert.equal(res.status, 404, res.text);
  });

  test('소식 메일 받기 (2026-11-27): 선택 칸, 동의한 계정만 서버 자신에게 주소를 준다 (Lookups news-address)', async () => {
    const db = api.service(Database);
    const query = api.service(AccountQuery);
    const yes = CommunitySite.emailOf(`newsyes${mark}`);
    const no = CommunitySite.emailOf(`newsno${mark}`);
    assert.equal((await storeJoin(yes, { newsMail: true })).status, 201);
    assert.equal((await storeJoin(no)).status, 201, '보내지 않으면 받지 않음 (가입은 된다)');
    const ids = await db.sql<{ id: string; email: string; news: boolean }[]>`
      SELECT id, email, news_agreed_at IS NOT NULL AS news FROM community.accounts
      WHERE email IN (${yes}, ${no})`;
    const idOf = (email: string) => ids.find((r) => r.email === email)?.id ?? '';
    assert.deepEqual(ids.find((r) => r.email === yes)?.news, true);
    assert.deepEqual(ids.find((r) => r.email === no)?.news, false);
    const all = [idOf(yes), idOf(no)];
    const seen = await query.newsAddresses(new SystemActor(), all);
    assert.deepEqual([...seen.entries()], [[idOf(yes), yes]]);
    assert.equal((await query.newsAddresses(new VisitorActor(), all)).size, 0);
    const [event] = await db.sql<{ data: unknown }[]>`
      SELECT payload AS data FROM platform.outbox
      WHERE topic = 'community.account.news' AND payload->>'accountId' = ${idOf(yes)}`;
    assert.deepEqual(
      event?.data,
      { v: 1, accountId: idOf(yes), agreed: true },
      '메일 주소는 싣지 않는다',
    );
    const bad = await storeJoin(CommunitySite.emailOf(`newsbad${mark}`), { newsMail: 'yes' });
    assert.equal(bad.status, 400);
  });
});
