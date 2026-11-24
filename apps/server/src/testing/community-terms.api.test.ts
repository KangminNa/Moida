import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Database } from '../modules/platform';
import { ApiClient, type ApiResult, TestUser } from './api-client';
import { CommunitySite } from './community-site';

// 약관 · 가입 동의 · 탈퇴 (2026-11-24, 스토어 3-4): 약관은 앱마다 둘(terms · privacy), 추가만 하는 버전.
// 둘 다 공개돼야 가입을 받고, 가입은 그때의 버전에 동의한다. 탈퇴하면 개인정보를 지우고 글은 "탈퇴한 회원"으로 남는다

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let site: CommunitySite;
const mark = randomUUID().slice(0, 6);
const PASSWORD = '오늘은 비가 와서 집에 있다';

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** 약관 없이 공개한 커뮤니티 앱 (CommunitySite.link는 약관을 먼저 공개한다) */
async function bareApp(slug: string): Promise<{ id: string; host: string }> {
  const host = `${slug}.example.com`;
  const app = ok(
    await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind: 'community',
      name: `빈 약관 ${slug}`,
      slug,
    }),
    201,
  );
  const set = ok(
    await api.request('PATCH', `/api/apps/${app.id}`, owner, {
      version: app.version,
      domain: host,
    }),
  );
  const { token } = ok(await api.viaHost('/.well-known/cairn-domain', host));
  const checked = ok(
    await api.request('POST', `/api/apps/${app.id}/domain/check`, owner, {
      version: set.version,
      token,
    }),
  );
  ok(
    await api.request('PATCH', `/api/apps/${app.id}`, owner, {
      version: checked.version,
      visibility: 'public',
    }),
  );
  return { id: String(app.id), host };
}

const joinBody = (loginId: string, nickname: string, more: Json = {}) => ({
  loginId,
  password: PASSWORD,
  nickname,
  ageConfirmed: true,
  ...more,
});

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  site = await CommunitySite.open(api, owner, `terms-${mark}`);
});
after(() => api.close());

describe('약관 (스토어 3-4)', () => {
  test('공개 전: 관리 화면은 초안(앱 이름)과 ready false, 회원 화면은 404, 가입은 409', async () => {
    const bare = await bareApp(`bare-${mark}`);
    const admin = ok(await api.get(`/api/community/admin/${bare.id}/terms`, owner));
    assert.equal(admin.ready, false);
    const items = admin.items as Json[];
    assert.deepEqual(
      items.map((i) => [i.kind, i.current]),
      [
        ['terms', null],
        ['privacy', null],
      ],
    );
    assert.match(String(items[0]?.draft), new RegExp(`빈 약관 bare-${mark} 이용약관`));
    assert.equal((await api.get(`/api/community/admin/${bare.id}/terms`)).status, 403);
    assert.equal((await api.viaHost('/api/community/terms/terms', bare.host)).status, 404);
    const joined = await api.viaHost('/api/community/join', bare.host, {
      method: 'POST',
      body: joinBody(`bare${mark}`, `빈약관${mark}`, CommunitySite.AGREED),
      headers: { origin: `http://${bare.host}` },
    });
    assert.equal(joined.status, 409, joined.text);
    assert.match(joined.text, /아직 약관이 공개되지 않아/);
  });

  test('새 버전은 본 버전 다음으로만: 낡은 버전이면 409, 공개된 것은 마지막 버전', async () => {
    const path = `/api/community/admin/${site.appId}/terms/privacy`;
    const stale = await api.request('POST', path, owner, { version: 0, body: '# 옛것' });
    assert.equal(stale.status, 409, stale.text);
    const second = ok(
      await api.request('POST', path, owner, { version: 1, body: '  # 개인정보처리방침 2\n' }),
      201,
    );
    assert.deepEqual(
      [second.kind, second.version, second.body],
      ['privacy', 2, '# 개인정보처리방침 2'],
    );
    const shown = ok(await site.at('/api/community/terms/privacy'));
    assert.equal(shown.version, 2);
    assert.equal(shown.approved, undefined, '회원 화면에는 누가 올렸는지 싣지 않는다');
    assert.equal((await api.request('POST', path, owner, { version: 2, body: '' })).status, 400);
    assert.equal((await site.at('/api/community/terms/rules')).status, 400);

    // 가입 화면을 연 뒤 약관이 바뀌었으면 다시 읽게 한다 (개인정보처리방침은 이제 2)
    const old = await site.at('/api/community/join', {
      method: 'POST',
      body: joinBody(`late${mark}`, `늦은회원${mark}`, CommunitySite.AGREED),
    });
    assert.equal(old.status, 409, old.text);
    assert.match(old.text, /약관이 바뀌었어요/);
    const fresh = await site.at('/api/community/join', {
      method: 'POST',
      body: joinBody(`late${mark}`, `늦은회원${mark}`, { termsVersion: 1, privacyVersion: 2 }),
    });
    assert.equal(fresh.status, 201, fresh.text);
    const [row] = await db.sql<{ terms_version: number; privacy_version: number }[]>`
      SELECT terms_version, privacy_version FROM community.members
      WHERE app_id = ${site.appId} AND login_id = ${`late${mark}`}`;
    assert.deepEqual([row?.terms_version, row?.privacy_version], [1, 2], '동의한 버전을 남긴다');
  });
});

describe('탈퇴 (스토어 3-4)', () => {
  test('비밀번호가 맞아야 하고, 탈퇴하면 개인정보를 지우고 모든 로그인이 끝나며 글은 "탈퇴한 회원"으로 남는다', async () => {
    // 3-4 앞 단계에서 개인정보처리방침이 2가 되어 가입 도우미(AGREED)가 맞지 않는다: 버전을 맞춰 가입한다
    const loginId = `bye${mark}`;
    const joined = await site.at('/api/community/join', {
      method: 'POST',
      body: joinBody(loginId, `떠날회원${mark}`, { termsVersion: 1, privacyVersion: 2 }),
    });
    assert.equal(joined.status, 201, joined.text);
    const me = new TestUser(joined.cookies());
    await db.sql`
      UPDATE community.members SET joined_at = joined_at - interval '10 minutes'
      WHERE app_id = ${site.appId} AND login_id = ${loginId}`;
    const topic = ok(
      await site.write(me, 'POST', '/api/community/topics', {
        requestId: randomUUID(),
        title: '떠나기 전 글',
        body: '남는 글',
      }),
      201,
    );
    const other = await site.at('/api/community/login', {
      method: 'POST',
      body: { loginId, password: PASSWORD },
    });
    const elsewhere = new TestUser(other.cookies());

    const wrong = await site.write(me, 'POST', '/api/community/me/leave', {
      password: '틀린 비밀번호입니다',
    });
    assert.equal(wrong.status, 400, wrong.text);
    const left = await site.write(me, 'POST', '/api/community/me/leave', { password: PASSWORD });
    assert.equal(left.status, 204, left.text);

    assert.equal(ok(await site.at('/api/community/me', { as: me })).member, null);
    assert.equal(
      ok(await site.at('/api/community/me', { as: elsewhere })).member,
      null,
      '다른 로그인도 끝난다',
    );
    const again = await site.at('/api/community/login', {
      method: 'POST',
      body: { loginId, password: PASSWORD },
    });
    assert.equal(again.status, 401);
    const [row] = await db.sql<Json[]>`
      SELECT id, login_id, password_hash, nickname, nickname_key, left_at, block_note, last_seen_at
      FROM community.members WHERE app_id = ${site.appId} AND left_at IS NOT NULL`;
    assert.deepEqual(
      [row?.login_id, row?.password_hash, row?.nickname, row?.nickname_key],
      [`left:${row?.id}`, '', '탈퇴한 회원', `left:${row?.id}`],
    );
    const shown = ok(await site.at(`/api/community/topics/${topic.id}`));
    assert.equal((shown.author as Json).nickname, '탈퇴한 회원');
    assert.equal(shown.title, '떠나기 전 글', '글은 남는다');

    // 같은 아이디 · 닉네임은 다시 쓸 수 있다 (지운 정보를 남기지 않는다), "탈퇴"가 든 닉네임은 막는다
    const back = await site.at('/api/community/join', {
      method: 'POST',
      body: joinBody(loginId, `떠날회원${mark}`, { termsVersion: 1, privacyVersion: 2 }),
      headers: { 'x-forwarded-for': '10.99.0.1' },
    });
    assert.equal(back.status, 201, back.text);
    const fake = await site.at('/api/community/join', {
      method: 'POST',
      body: joinBody(`fake${mark}`, '탈퇴한 회원', { termsVersion: 1, privacyVersion: 2 }),
      headers: { 'x-forwarded-for': '10.99.0.2' },
    });
    assert.equal(fake.status, 422);
  });
});
