import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';
import { Database, PasswordHasher } from '../../platform';

// 스토어 계정 (2026-11-26): 공간에 계정 하나, 앱마다 참여. 같은 계정으로 다른 앱에 로그인 · 참여, 앱에서 나가기와 계정 탈퇴,
// 관리자의 계정 정지 · 풀기, 옮겨 온 옛 계정의 빈 아이디 · 메일 · 공통 약관 채우기

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let town: CommunitySite;
let club: CommunitySite;
const mark = randomUUID().slice(0, 6);
const PASSWORD = CommunitySite.PASSWORD;
const { termsVersion, privacyVersion, ...APP } = CommunitySite.AGREED;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** 그 앱 도메인에 로그인한 브라우저 */
async function signIn(site: CommunitySite, login: string, password = PASSWORD): Promise<TestUser> {
  const res = await site.at('/api/community/login', {
    method: 'POST',
    body: { login, password },
    headers: { 'x-forwarded-for': CommunitySite.nextPlace() },
  });
  assert.equal(res.status, 200, res.text);
  return new TestUser(res.cookies());
}

const me = async (site: CommunitySite, as: TestUser) =>
  ok(await site.at('/api/community/me', { as }));

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  town = await CommunitySite.open(api, owner, `acc-town-${mark}`);
  club = await CommunitySite.open(api, owner, `acc-club-${mark}`);
});
after(() => api.close());

describe('계정 하나로 여러 앱', () => {
  test('다른 앱에서는 같은 계정으로 로그인하고 닉네임만 정해 참여한다 (두 번 참여는 409)', async () => {
    const email = CommunitySite.emailOf(`roam${mark}`);
    await town.member(`roam${mark}`, '떠돌이');
    const again = await CommunitySite.join(api, club.host, { email, nickname: '떠돌이' });
    assert.equal(again.status, 400, '같은 메일로는 다시 가입하지 않는다 (코드 대신 안내 메일)');
    assert.match(CommunitySite.mailbox(api).to(email).at(-1)?.subject ?? '', /이미 가입한/);

    const browser = await signIn(club, CommunitySite.loginIdOf(email));
    const before = await me(club, browser);
    assert.equal((before.account as Json).email, email);
    assert.equal(before.member, null, '참여 전');
    const write = await club.write(browser, 'POST', '/api/community/topics', {
      requestId: randomUUID(),
      title: '참여 전',
      body: '본문',
    });
    assert.equal(write.status, 401, '참여 전에는 쓰지 못한다');
    const entered = ok(
      await club.write(browser, 'POST', '/api/community/enter', { nickname: '떠돌이', ...APP }),
      201,
    );
    assert.equal(entered.nickname, '떠돌이', '닉네임은 앱마다라 같아도 된다');
    assert.equal(((await me(club, browser)).member as Json).nickname, '떠돌이');
    const twice = await club.write(browser, 'POST', '/api/community/enter', {
      nickname: '또참여',
      ...APP,
    });
    assert.equal(twice.status, 409);
  });

  test('앱의 약관에 동의하지 않은 참여는 409', async () => {
    const email = CommunitySite.emailOf(`nodeal${mark}`);
    await town.member(`nodeal${mark}`, '동의안함');
    const browser = await signIn(club, email);
    const res = await club.write(browser, 'POST', '/api/community/enter', { nickname: '동의안함' });
    assert.equal(res.status, 409, res.text);
    assert.match(res.text, /약관/);
  });
});

describe('앱에서 나가기 · 계정 탈퇴', () => {
  test('앱에서 나가면 그 앱의 회원만 지우고 계정 · 로그인 · 다른 앱은 그대로, 다시 참여할 수 있다', async () => {
    const email = CommunitySite.emailOf(`quit${mark}`);
    const atTown = await town.member(`quit${mark}`, '나갈회원');
    const atClub = await club.enter(email, '남을회원');
    const topic = ok(
      await town.write(atTown, 'POST', '/api/community/topics', {
        requestId: randomUUID(),
        title: '나가기 전 글',
        body: '남는 글',
      }),
      201,
    );
    const wrong = await town.write(atTown, 'POST', '/api/community/me/leave', {
      password: '틀린 비밀번호입니다',
    });
    assert.equal(wrong.status, 400);
    const left = await town.write(atTown, 'POST', '/api/community/me/leave', {
      password: PASSWORD,
    });
    assert.equal(left.status, 204, left.text);

    const after = await me(town, atTown);
    assert.equal((after.account as Json).email, email, '로그인은 그대로');
    assert.equal(after.member, null);
    assert.equal(((await me(club, atClub)).member as Json).nickname, '남을회원');
    const shown = ok(await town.at(`/api/community/topics/${topic.id}`));
    assert.equal((shown.author as Json).nickname, '탈퇴한 회원');
    const back = await town.write(atTown, 'POST', '/api/community/enter', {
      nickname: '돌아온회원',
      ...APP,
    });
    assert.equal(back.status, 201, back.text);
  });

  test('계정 탈퇴는 모든 앱에서 나가고 개인정보를 지우며 모든 로그인이 끝난다 (같은 메일로 다시 가입할 수 있다)', async () => {
    const email = CommunitySite.emailOf(`gone${mark}`);
    const atTown = await town.member(`gone${mark}`, '떠날계정');
    const atClub = await club.enter(email, '떠날계정');
    const bye = await club.write(atClub, 'POST', '/api/community/account/leave', {
      password: PASSWORD,
    });
    assert.equal(bye.status, 204, bye.text);
    assert.equal((await me(town, atTown)).account, null, '다른 앱의 로그인도 끝난다');
    const again = await town.at('/api/community/login', {
      method: 'POST',
      body: { login: email, password: PASSWORD },
    });
    assert.equal(again.status, 401);
    const [account] = await db.sql<Json[]>`
      SELECT a.login_id, a.email, a.password_hash, a.left_at,
        (SELECT count(*)::int FROM community.members m WHERE m.account_id = a.id) AS linked
      FROM community.accounts a
      WHERE a.left_at IS NOT NULL AND a.id IN (
        SELECT s.account_id FROM community.account_sessions s WHERE s.app_id = ${club.appId})`;
    assert.deepEqual(
      [account?.login_id, account?.email, account?.password_hash, account?.linked],
      [null, null, '', 0],
    );
    const rejoin = await CommunitySite.join(api, town.host, { email, nickname: '새계정' });
    assert.equal(rejoin.status, 201, rejoin.text);
  });
});

describe('관리자의 계정 정지', () => {
  test('정지하면 지금 로그인이 끝나고 모든 앱의 로그인이 403, 풀면 다시 된다. 관리자만 · 기본 도메인에서만', async () => {
    const email = CommunitySite.emailOf(`susp${mark}`);
    const browser = await town.member(`susp${mark}`, '정지될이');
    assert.equal((await api.get('/api/community/admin/accounts')).status, 403);
    assert.equal((await town.at('/api/community/admin/accounts')).status, 404);
    const list = ok(await api.get('/api/community/admin/accounts', owner));
    const line = (list.items as Json[]).find((a) => a.email === email);
    assert.ok(line, '목록에 보인다');
    assert.equal(line.apps, 1);
    const path = `/api/community/admin/accounts/${line.id}`;
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const suspended = ok(
      await api.request('POST', `${path}/suspend`, owner, { version: line.version, until }),
    );
    assert.equal(suspended.suspendedUntil, until);
    assert.equal((await me(town, browser)).account, null, '지금 로그인이 끝난다');
    const blocked = await club.at('/api/community/login', {
      method: 'POST',
      body: { login: email, password: PASSWORD },
    });
    assert.equal(blocked.status, 403);
    assert.match(blocked.text, /정지된 계정/);
    ok(await api.request('POST', `${path}/unsuspend`, owner, { version: suspended.version }));
    await signIn(club, email);
  });
});

describe('옮겨 온 옛 계정', () => {
  test('메일 없는 계정은 코드로 메일을 등록하고, 공통 약관에 동의하며 앱에 참여한다', async () => {
    const hash = await api.service(PasswordHasher).hash(PASSWORD);
    const loginId = `old_${mark.replaceAll('-', '')}`.slice(0, 20);
    await db.sql`
      INSERT INTO community.accounts (space_id, login_id, password_hash, password_changed_at, age_confirmed_at)
      SELECT DISTINCT space_id, ${loginId}, ${hash}, now(), now() FROM community.terms WHERE space_id IS NOT NULL LIMIT 1`;
    const browser = await signIn(town, loginId);
    assert.deepEqual(((await me(town, browser)).account as Json).needs, ['email', 'terms']);

    const noTerms = await town.write(browser, 'POST', '/api/community/enter', {
      nickname: '옛계정',
      ...APP,
    });
    assert.equal(noTerms.status, 409, '공통 약관에 아직 동의하지 않았다');
    ok(
      await town.write(browser, 'POST', '/api/community/enter', {
        nickname: '옛계정',
        ...CommunitySite.AGREED,
      }),
      201,
    );

    const email = CommunitySite.emailOf(`oldmail${mark}`);
    const sent = await town.write(browser, 'POST', '/api/community/account/email/code', { email });
    assert.equal(sent.status, 204, sent.text);
    const code = CommunitySite.mailbox(api).codeFor(email);
    const wrong = await town.write(browser, 'PUT', '/api/community/account/email', {
      email,
      code: '000000',
    });
    assert.equal(wrong.status, 400);
    const set = ok(
      await town.write(browser, 'PUT', '/api/community/account/email', { email, code }),
    );
    assert.equal(set.email, email);
    assert.deepEqual(set.needs, []);
    await signIn(club, email);
  });

  test('아이디 없는 계정은 아이디를 한 번 정한다 (겹치면 409, 이미 있으면 409)', async () => {
    const email = CommunitySite.emailOf(`noid${mark}`);
    const browser = await town.member(`noid${mark}`, '아이디없음');
    await db.sql`UPDATE community.accounts SET login_id = NULL WHERE email = ${email}`;
    const self = (await me(town, browser)).account as Json;
    assert.deepEqual(self.needs, ['loginId']);
    const taken = await town.write(browser, 'PUT', '/api/community/account/login-id', {
      version: self.version,
      loginId: CommunitySite.loginIdOf(CommunitySite.emailOf(`roam${mark}`)),
    });
    assert.equal(taken.status, 409, taken.text);
    const reserved = await town.write(browser, 'PUT', '/api/community/account/login-id', {
      version: self.version,
      loginId: 'admin',
    });
    assert.equal(reserved.status, 400);
    const loginId = `noid_${mark}`.replaceAll('-', '_');
    const set = ok(
      await town.write(browser, 'PUT', '/api/community/account/login-id', {
        version: self.version,
        loginId,
      }),
    );
    assert.equal(set.loginId, loginId);
    const twice = await town.write(browser, 'PUT', '/api/community/account/login-id', {
      version: set.version,
      loginId: `${loginId}x`.slice(0, 20),
    });
    assert.equal(twice.status, 409);
    await signIn(club, loginId);
  });
});
