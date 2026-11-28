import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';
import { Database } from '../../platform';

// 약관 · 가입 동의 (2026-11-24, 스토어 3-4 · 스토어 계정 2026-11-26): 약관은 공간(스토어)의 공통 약관 둘과 앱마다 둘(terms · privacy), 추가만 하는 버전.
// 공통 약관이 공개돼야 가입을 받고, 앱의 약관은 공개했을 때만 그 앱에 참여할 때 동의한다. 동의는 그때의 버전이어야 한다 (탈퇴는 account.api.test)

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let site: CommunitySite;
const mark = randomUUID().slice(0, 6);

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
  const { token } = ok(await api.viaHost('/.well-known/moida-domain', host));
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

/** 이 앱 도메인에서 메일 인증 가입 한 번 (코드를 주면 그 코드로, 안 주면 새로 받아서) */
const joinAt = (host: string, name: string, nickname: string, more: Json = {}, code?: string) =>
  CommunitySite.join(api, host, { email: CommunitySite.emailOf(name), nickname, code, ...more });

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  site = await CommunitySite.open(api, owner, `terms-${mark}`);
});
after(() => api.close());

describe('약관 (스토어 3-4)', () => {
  test('앱 약관 없이: 관리 화면은 초안(앱 이름)과 ready false, 회원 화면은 404, 가입은 공통 약관만으로 된다', async () => {
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
    assert.equal((await api.viaHost('/api/community/terms/store/terms', bare.host)).status, 200);
    const { appTermsVersion, appPrivacyVersion, ...store } = CommunitySite.AGREED;
    const withApp = await joinAt(bare.host, `bareapp${mark}`, `빈앱${mark}`);
    assert.equal(withApp.status, 409, '공개하지 않은 앱 약관에 동의할 수 없다');
    const joined = await joinAt(bare.host, `bare${mark}`, `빈약관${mark}`, {
      ...store,
      appTermsVersion: null,
      appPrivacyVersion: null,
    });
    assert.equal(joined.status, 201, joined.text);
  });

  test('공통 약관: 관리자만 · 기본 도메인에서, 앱 도메인의 회원 화면에서 읽는다', async () => {
    const admin = ok(await api.get('/api/community/admin/terms', owner));
    assert.equal(admin.ready, true);
    assert.match(String((admin.items as Json[])[0]?.draft), /이 사이트 이용약관/);
    assert.equal((await api.get('/api/community/admin/terms')).status, 403);
    assert.equal((await site.at('/api/community/admin/terms')).status, 404);
    const shown = ok(await site.at('/api/community/terms/store/privacy'));
    assert.equal(shown.kind, 'privacy');
    assert.equal((await site.at('/api/community/terms/store/rules')).status, 400);
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

    // 가입 화면을 연 뒤 약관이 바뀌었으면 다시 읽게 한다 (이 앱의 개인정보처리방침은 이제 2)
    const email = CommunitySite.emailOf(`late${mark}`);
    const sent = await site.at('/api/community/join/code', { method: 'POST', body: { email } });
    assert.equal(sent.status, 204, sent.text);
    const code = CommunitySite.mailbox(api).codeFor(email);
    const old = await joinAt(
      site.host,
      `late${mark}`,
      `늦은회원${mark}`,
      CommunitySite.AGREED,
      code,
    );
    assert.equal(old.status, 409, old.text);
    assert.match(old.text, /약관이 바뀌었어요/);
    const fresh = await joinAt(
      site.host,
      `late${mark}`,
      `늦은회원${mark}`,
      { ...CommunitySite.AGREED, appPrivacyVersion: 2 },
      code,
    );
    assert.equal(fresh.status, 201, fresh.text);
    const [row] = await db.sql<{ terms_version: number; privacy_version: number }[]>`
      SELECT m.terms_version, m.privacy_version FROM community.members m
      JOIN community.accounts a ON a.id = m.account_id
      WHERE m.app_id = ${site.appId} AND a.email = ${email}`;
    assert.deepEqual([row?.terms_version, row?.privacy_version], [1, 2], '동의한 버전을 남긴다');
  });
});
