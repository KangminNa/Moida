import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Database, OutboxWorker } from '../modules/platform';
import { ApiClient, TestUser } from './api-client';
import { CommunitySite } from './community-site';

// 가입자 소식 메일 (2026-11-27, 플러그인 email): 가입 때 "소식 메일 받기"에 동의한 계정에게,
// 대표가 쓰고(mail_news_draft) 관리자가 승인한(email.news.send) 메일만 나간다. 해지 링크로 끊으면 계정의 동의도 지운다.
// 메일 서버 설정 없이 대기열까지만 본다 (보내기의 주고받기는 email.api.test · plugins/email/server/email.test.ts)

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 읽는 테스트 (모양은 assert가 본다)
type Json = Record<string, any>;
let api: ApiClient;
let owner: TestUser;
let runner: string;
const mark = randomUUID().slice(0, 6);
const { termsVersion, privacyVersion } = CommunitySite.AGREED;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};
const drain = async () => {
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
};
const db = () => api.service(Database);

async function tool(token: string, name: string, args: Json = {}) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  assert.ok(res.json().result, `${name}: ${res.text}`);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') as Json }
    : { ok: true, body: (result.structuredContent ?? {}) as Json };
}

/** 기본 도메인의 스토어 가입 (소식 메일 받기를 고르거나 말거나) */
async function storeJoin(email: string, newsMail: boolean): Promise<string> {
  const box = CommunitySite.mailbox(api);
  const headers = { 'x-forwarded-for': CommunitySite.nextPlace() };
  const sent = await api.request(
    'POST',
    '/api/store/join/code',
    TestUser.visitor,
    { email },
    headers,
  );
  assert.equal(sent.status, 204, sent.text);
  const joined = await api.request(
    'POST',
    '/api/store/join',
    TestUser.visitor,
    {
      email,
      code: box.codeFor(email),
      loginId: CommunitySite.loginIdOf(email),
      password: CommunitySite.PASSWORD,
      ageConfirmed: true,
      termsVersion,
      privacyVersion,
      newsMail,
    },
    headers,
  );
  return String(ok(joined, 201).id);
}

/** 대표의 일을 내 러너가 빌린 작업 토큰 (대표는 email.news.send를 승인 동작에 넣지 않아도 올린다) */
async function leadToken(): Promise<{ token: string; taskId: string }> {
  let lead = ok(await api.get('/api/agents/lead', owner)).lead as Json | null;
  if (!lead) {
    ok(
      await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message: '시작' }),
      201,
    );
    lead = ok(await api.get('/api/agents/lead', owner)).lead as Json;
  }
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: lead.id,
      instruction: '가입자에게 이번 주 소식을 메일로',
    }),
    201,
  );
  for (let round = 0; round < 20; round++) {
    const next = await tool(runner, 'next_jobs', { wait_seconds: 0, limit: 10, tools: ['claude'] });
    const job = (next.body.jobs as Json[]).find((j) => (j.task as Json).id === task.id);
    if (job) return { token: String(job.run_token), taskId: String(task.id) };
  }
  throw new Error('빌린 일이 없다');
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  await CommunitySite.open(api, owner, `news-${mark}`);
  ok(await api.request('POST', '/api/plugins/email/enable', owner));
  // MCP는 도구 답의 링크에 사이트 주소를 쓴다: 이 서버의 주소로 정해 둔다
  const space = ok(await api.get('/api/space'));
  ok(
    await api.request('PUT', '/api/space', owner, {
      name: space.name || '돌무더기',
      siteUrl: api.baseUrl,
      version: space.version,
    }),
  );
  const made = await api.request('POST', '/api/devices/runner', owner, {
    requestId: randomUUID(),
    name: `소식 러너 ${mark}`,
  });
  runner = String(ok(made, 201).token);
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
});
after(() => api.close());

describe('가입자 소식 메일 (email)', () => {
  let yes = '';
  let yesId = '';

  test('가입 때 동의한 계정만 받는 사람이 된다 (주소는 이벤트가 아니라 서버 자신의 읽기로)', async () => {
    yes = CommunitySite.emailOf(`newsyes${mark}`);
    yesId = await storeJoin(yes, true);
    const noId = await storeJoin(CommunitySite.emailOf(`newsno${mark}`), false);
    await drain();
    const rows = await db().sql<{ account_id: string; address: string; status: string }[]>`
      SELECT account_id, address, status FROM email.subscribers
      WHERE account_id IN (${yesId}, ${noId})`;
    assert.deepEqual(
      rows.map((r) => [r.account_id, r.address, r.status]),
      [[yesId, yes, 'active']],
    );
  });

  test('대표가 쓰고 → 승인해야 나간다. 같은 요청은 한 통, 승인 뒤 기다리던 일이 이어진다', async () => {
    const { token, taskId } = await leadToken();
    const requestId = randomUUID();
    const draft = await tool(token, 'mail_news_draft', {
      request_id: requestId,
      subject: '이번 주 소식',
      body: '새 앱이 열렸어요.',
    });
    assert.equal(draft.ok, true, JSON.stringify(draft.body));
    assert.equal(draft.body.status, 'draft');
    assert.ok(Number(draft.body.recipients) >= 1);
    const again = await tool(token, 'mail_news_draft', {
      request_id: requestId,
      subject: '다른 제목',
      body: '다른 본문',
    });
    assert.equal(again.body.send_id, draft.body.send_id, '같은 요청은 처음 초안');
    const queuedBefore = await db().sql`
      SELECT 1 FROM email.deliveries WHERE send_id = ${draft.body.send_id}`;
    assert.equal(queuedBefore.length, 0, '승인 전에는 대기열에 오르지 않는다');
    const console = await api.request(
      'POST',
      `/api/p/email/sends/${draft.body.send_id}/start`,
      owner,
    );
    assert.equal(console.status, 409, '콘솔의 보내기로는 나가지 않는다 (결과 카드의 승인으로)');

    const asked = await tool(token, 'request_approval', {
      request_id: randomUUID(),
      action: 'email.news.send',
      target_kind: 'email_send',
      target_id: draft.body.send_id,
      target_version: 1,
      note: '이번 주 소식',
    });
    assert.equal(asked.ok, true, JSON.stringify(asked.body));
    const approval = ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
        version: approval.version,
        decision: 'approve',
      }),
    );
    await drain();
    const [send] = await db().sql<{ status: string; total: number }[]>`
      SELECT status, total FROM email.sends WHERE id = ${draft.body.send_id}`;
    assert.equal(send?.status, 'sending');
    assert.ok(Number(send?.total) >= 1);
    const mine = await db().sql`
      SELECT 1 FROM email.deliveries d JOIN email.subscribers p ON p.id = d.subscriber_id
      WHERE d.send_id = ${draft.body.send_id} AND p.account_id = ${yesId}`;
    assert.equal(mine.length, 1, '동의한 가입자에게 한 줄');
    assert.notEqual(ok(await api.get(`/api/tasks/${taskId}`, owner)).status, 'waiting');
  });

  test('반려하면 그 초안은 나가지 않는다', async () => {
    const { token } = await leadToken();
    const draft = await tool(token, 'mail_news_draft', {
      request_id: randomUUID(),
      subject: '보내지 않을 소식',
      body: '본문',
    });
    const asked = await tool(token, 'request_approval', {
      request_id: randomUUID(),
      action: 'email.news.send',
      target_kind: 'email_send',
      target_id: draft.body.send_id,
      target_version: 1,
      note: '반려할 것',
    });
    const approval = ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
        version: approval.version,
        decision: 'reject',
        note: '다르게',
      }),
    );
    await drain();
    const [send] = await db().sql<{ status: string }[]>`
      SELECT status FROM email.sends WHERE id = ${draft.body.send_id}`;
    assert.equal(send?.status, 'cancelled');
  });

  test('해지 링크로 끊으면 줄을 지우고 계정의 동의도 지운다', async () => {
    const [row] = await db().sql<{ token: string }[]>`
      SELECT token FROM email.subscribers WHERE account_id = ${yesId}`;
    assert.ok(row);
    ok(await api.request('POST', `/api/p/email/unsubscribe/${row.token}`, TestUser.visitor, {}));
    await drain();
    const [account] = await db().sql<{ news: boolean }[]>`
      SELECT news_agreed_at IS NOT NULL AS news FROM community.accounts WHERE id = ${yesId}`;
    assert.equal(account?.news, false);
    const left = await db().sql`SELECT 1 FROM email.subscribers WHERE account_id = ${yesId}`;
    assert.equal(left.length, 0);
  });
});
