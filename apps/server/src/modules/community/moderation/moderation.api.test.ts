import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';
import { OutboxWorker } from '../../platform';

// 커뮤니티 관리 (스토어 3-1c): 서로 다른 회원 3명의 신고로 임시 가림(일꾼) → 관리자 알림, 관리자의 가림 · 되돌림 · 내림,
// 회원 차단 · 풀기 · 비밀번호 초기화, 결정 기록. 관리 API는 관리자만 · 기본 도메인에서만 (원칙 10)

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let site: CommunitySite;
let writer: TestUser;
let worker: OutboxWorker;
const mark = randomUUID().slice(0, 8);
const PASSWORD = '오늘은 비가 와서 집에 있다';

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** 일꾼을 outbox가 빌 때까지 돌린다 (신고 → 임시 가림) */
async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

function admin(path: string, as: TestUser = owner): Promise<ApiResult> {
  return api.get(`/api/community/admin/${site.appId}${path}`, as);
}

function decide(path: string, body: object, as: TestUser = owner): Promise<ApiResult> {
  return api.request('POST', `/api/community/admin/${site.appId}${path}`, as, body);
}

async function topic(title: string): Promise<Json> {
  return ok(
    await site.write(writer, 'POST', '/api/community/topics', {
      requestId: randomUUID(),
      title,
      body: `${title} 본문 ${randomUUID()}`,
    }),
    201,
  );
}

async function reportBy(loginIds: readonly string[], target: object): Promise<void> {
  for (const loginId of loginIds) {
    const reporter = await site.member(`${loginId}_${mark.slice(0, 4)}`, `신고${loginId}`);
    ok(
      await site.write(reporter, 'POST', '/api/community/reports', { ...target, reason: 'spam' }),
      201,
    );
  }
  await drain();
}

async function memberLine(loginId: string): Promise<Json> {
  const items = ok(await admin('/members')).items as Json[];
  const found = items.find((m) => m.loginId === CommunitySite.emailOf(loginId));
  assert.ok(found, JSON.stringify(items.slice(0, 3)));
  return found;
}

async function notices(title: string): Promise<Json[]> {
  const all = ok(await api.get('/api/notifications', owner)).notifications as Json[];
  return all.filter((n) => n.title === title);
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  worker = api.service(OutboxWorker);
  site = await CommunitySite.open(api, owner, `moderation-${mark}`);
  writer = await site.member('mod_writer', '관리받는이');
});
after(() => api.close());

describe('신고로 임시 가림', () => {
  test('서로 다른 회원 3명이 신고하면 일꾼이 가리고(2명은 그대로) 관리자에게 바로 알린다', async () => {
    const t = await topic('가려질 글');
    await reportBy(['ra', 'rb'], { topicId: t.id });
    ok(await site.at(`/api/community/topics/${t.id}`));
    await reportBy(['rc'], { topicId: t.id });
    assert.equal((await site.at(`/api/community/topics/${t.id}`)).status, 404);
    // 쓴 회원도 가려진 글은 고치지 못한다
    const edit = await site.write(writer, 'PATCH', `/api/community/topics/${t.id}`, {
      version: t.version,
      title: '고쳐 보기',
      body: '고친 본문',
    });
    assert.equal(edit.status, 409, edit.text);

    const hidden = ok(await admin('/topics?state=hidden')).items as Json[];
    const line = hidden.find((x) => x.id === t.id) as Json;
    assert.deepEqual([line.state, line.hiddenBy, line.openReports], ['hidden', 'reports', 3]);
    assert.deepEqual((line.author as Json).loginId, CommunitySite.emailOf('mod_writer'));
    const [decision] = ok(await admin('/decisions')).items as Json[];
    assert.ok(decision);
    assert.deepEqual(
      [decision.action, decision.by, (decision.target as Json).id],
      ['hide', 'system', t.id],
    );
    assert.ok((await notices('신고로 가린 글')).some((n) => n.read === false));
  });

  test('되돌리면 다시 보이고 신고는 기각, 그 앞의 신고로 다시 가리지 않는다', async () => {
    const t = await topic('되돌릴 글');
    await reportBy(['sa', 'sb', 'sc'], { topicId: t.id });
    const detail = ok(await admin(`/topics/${t.id}`));
    assert.equal(detail.state, 'hidden');
    const unread = async () =>
      (await notices('신고로 가린 글')).filter((n) => n.read === false).length;
    const unreadBefore = await unread();
    const stale = await decide(`/topics/${t.id}/decide`, { version: 1, action: 'show' });
    assert.equal(stale.status, 409, stale.text);
    const shown = ok(
      await decide(`/topics/${t.id}/decide`, {
        version: detail.version,
        action: 'show',
        note: '광고가 아니에요',
      }),
    );
    assert.deepEqual([shown.state, shown.hiddenBy], ['shown', null]);
    ok(await site.at(`/api/community/topics/${t.id}`));
    const dismissed = ok(await admin('/reports?state=dismissed')).items as Json[];
    assert.equal(dismissed.filter((r) => (r.target as Json).id === t.id).length, 3);
    // 가림 알림은 정하면 읽음: 이 글의 알림 하나만 줄고, 앞 테스트의 가린 글 알림은 남는다
    assert.ok(unreadBefore >= 2, String(unreadBefore));
    assert.equal(await unread(), unreadBefore - 1);
    // 정한 뒤의 새 신고는 1건이라 그대로 보인다
    await reportBy(['sd'], { topicId: t.id });
    ok(await site.at(`/api/community/topics/${t.id}`));
  });

  test('댓글도 같다: 내리면 신고를 인정하고, 되돌리고, 쓴 회원이 지운 것은 정하지 않는다', async () => {
    const t = await topic('댓글 받을 글');
    const c = ok(
      await site.write(writer, 'POST', `/api/community/topics/${t.id}/comments`, {
        requestId: randomUUID(),
        body: '내려질 댓글',
      }),
      201,
    );
    await reportBy(['ca'], { commentId: c.id });
    const removed = ok(
      await decide(`/comments/${c.id}/decide`, { version: c.version, action: 'remove' }),
    );
    assert.equal(removed.state, 'removed');
    const view = ok(await site.at(`/api/community/topics/${t.id}`));
    assert.equal(
      (view.comments as Json[]).some((x) => x.id === c.id),
      false,
    );
    const accepted = ok(await admin('/reports?state=accepted')).items as Json[];
    assert.ok(
      accepted.some((r) => (r.target as Json).id === c.id && (r.target as Json).kind === 'comment'),
    );
    const again = await decide(`/comments/${c.id}/decide`, {
      version: removed.version,
      action: 'remove',
    });
    assert.equal(again.status, 409, again.text);
    assert.equal(
      (await decide(`/comments/${c.id}/decide`, { version: removed.version, action: 'erase' }))
        .status,
      422,
    );
    const back = ok(
      await decide(`/comments/${c.id}/decide`, { version: removed.version, action: 'show' }),
    );
    assert.equal(back.state, 'shown');

    const mine = ok(
      await site.write(writer, 'POST', `/api/community/topics/${t.id}/comments`, {
        requestId: randomUUID(),
        body: '내가 지울 댓글',
      }),
      201,
    );
    const deleted = await site.write(writer, 'DELETE', `/api/community/comments/${mine.id}`, {
      version: mine.version,
    });
    assert.equal(deleted.status, 204, deleted.text);
    const late = await decide(`/comments/${mine.id}/decide`, {
      version: Number(mine.version) + 1,
      action: 'hide',
    });
    assert.equal(late.status, 409, late.text);
  });
});

describe('회원 차단 · 비밀번호 초기화', () => {
  test('차단하면 쓰기 · 신고가 403이고 내 정보에 보이며, 풀면 다시 쓴다', async () => {
    const m = await site.member('blocked_one', '차단될이');
    const line = await memberLine('blocked_one');
    const past = await decide(`/members/${line.id}/block`, {
      version: line.version,
      until: '2020-01-01T00:00:00Z',
    });
    assert.equal(past.status, 422, past.text);
    const blocked = ok(
      await decide(`/members/${line.id}/block`, { version: line.version, note: '도배' }),
    );
    assert.equal(String(blocked.blockedUntil).slice(0, 4), '9999');
    const write = await site.write(m, 'POST', '/api/community/topics', {
      requestId: randomUUID(),
      title: '차단 중',
      body: '못 쓴다',
    });
    assert.equal(write.status, 403, write.text);
    const t = await topic('차단 회원이 신고할 글');
    assert.equal(
      (await site.write(m, 'POST', '/api/community/reports', { topicId: t.id, reason: 'spam' }))
        .status,
      403,
    );
    const me = ok(await site.at('/api/community/me', { as: m }));
    assert.equal(String((me.member as Json).blockedUntil).slice(0, 4), '9999');

    const freed = ok(await decide(`/members/${line.id}/unblock`, { version: blocked.version }));
    assert.equal(freed.blockedUntil, null);
    ok(
      await site.write(m, 'POST', '/api/community/topics', {
        requestId: randomUUID(),
        title: '풀린 뒤',
        body: '다시 쓴다',
      }),
      201,
    );
    assert.equal(
      (await decide(`/members/${line.id}/unblock`, { version: freed.version })).status,
      409,
    );
    const actions = (ok(await admin('/decisions')).items as Json[])
      .filter((d) => (d.target as Json).id === line.id)
      .map((d) => d.action);
    assert.deepEqual(actions, ['unblock', 'block']);
  });

  test('초기화하면 임시 비밀번호가 응답에 한 번만 오고, 옛 비밀번호 · 로그인은 끝난다', async () => {
    const m = await site.member('forgot_one', '잊은이');
    const line = await memberLine('forgot_one');
    const reset = ok(await decide(`/members/${line.id}/reset-password`, { version: line.version }));
    assert.match(String(reset.password), /^[a-z2-9]{16}$/);
    assert.equal(reset.loginId, CommunitySite.emailOf('forgot_one'));
    assert.equal('password' in (await memberLine('forgot_one')), false);
    assert.equal(ok(await site.at('/api/community/me', { as: m })).member, null);
    const login = (password: string) =>
      site.at('/api/community/login', {
        method: 'POST',
        body: { login: CommunitySite.emailOf('forgot_one'), password },
      });
    assert.equal((await login(PASSWORD)).status, 401);
    ok(await login(String(reset.password)));
  });
});

describe('관리 API의 문 (원칙 10)', () => {
  test('관리자만, 기본 도메인에서만, 공간의 커뮤니티 앱만', async () => {
    const m = await site.member('door_member', '문앞회원');
    assert.equal((await admin('/topics', TestUser.visitor)).status, 403);
    // 회원 쿠키는 기본 도메인에서 읽지 않는다
    assert.equal((await admin('/reports', m)).status, 403);
    const device = await api.writeDevice(owner, `mod-writer-${mark}`);
    const byDevice = await api.request(
      'GET',
      `/api/community/admin/${site.appId}/members`,
      TestUser.visitor,
      undefined,
      {
        authorization: `Bearer ${device}`,
      },
    );
    assert.equal(byDevice.status, 403);
    // 앱 도메인에서는 관리 경로가 없다 (관리자 쿠키여도)
    assert.equal(
      (await site.at(`/api/community/admin/${site.appId}/topics`, { as: owner })).status,
      404,
    );
    // 커뮤니티 앱이 아니거나 없는 앱은 404
    const blog = await api.blogApp(owner);
    assert.equal((await api.get(`/api/community/admin/${blog}/topics`, owner)).status, 404);
    assert.equal((await api.get(`/api/community/admin/${randomUUID()}/topics`, owner)).status, 404);
    const line = await memberLine('door_member');
    assert.equal(
      (await decide(`/members/${line.id}/block`, { version: line.version }, TestUser.visitor))
        .status,
      403,
    );
  });
});
