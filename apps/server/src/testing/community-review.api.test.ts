import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Database, OutboxWorker } from '../modules/platform';
import { ApiClient, type ApiResult, type TestUser } from './api-client';
import { CommunitySite } from './community-site';

// 커뮤니티 신고 검토 (2026-11-24, 스토어 3-3): 신고 → 검토 일(community_review, 대상마다 하나) → 일꾼이 빌린 작업 토큰은
// community_case · propose_setting만 본다 (비공개 · 바깥 도구 없음) → moderation 제안 → 관리자 승인 → 관리자 결정과 같은 줄
// (기록은 approved). 다른 설정 · 낡은 버전은 막는다

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let site: CommunitySite;
let writer: TestUser;
let runner: string;
const mark = randomUUID().slice(0, 6);
/** 신고한 회원 수 (아이디 · 닉네임이 겹치지 않게) */
let reporters = 0;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(token: string, name: string, args: Json = {}) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json & { content?: { text: string }[] };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content?.[0]?.text ?? '{}') as Json }
    : { ok: true, body: (result.structuredContent ?? {}) as Json };
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

async function topic(title: string): Promise<string> {
  const made = ok(
    await site.write(writer, 'POST', '/api/community/topics', {
      requestId: randomUUID(),
      title,
      body: `${title} 본문 ${randomUUID()}`,
    }),
    201,
  );
  return String(made.id);
}

async function report(topicId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    reporters += 1;
    const who = await site.member(`rv${mark}n${reporters}`, `검토신고${reporters}${mark}`);
    ok(await site.write(who, 'POST', '/api/community/reports', { topicId, reason: 'abuse' }), 201);
  }
  await drain();
}

const reviews = (topicId: string) => db.sql<
  { id: string; agent_id: string | null; status: string }[]
>`
  SELECT id, agent_id, status FROM task.tasks
  WHERE kind = 'community_review' AND payload->'communityReview'->>'topicId' = ${topicId}`;

/** 그 검토 일을 러너가 빌린다 (작업 토큰) */
async function lease(taskId: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const { body } = await tool(runner, 'next_jobs', { tools: ['claude'] });
    const job = (body.jobs as Json[]).find((j) => (j.task as Json).id === taskId);
    if (job) return String(job.run_token);
  }
  throw new Error('검토 일을 빌리지 못했어요');
}

const admin = (path: string) => api.get(`/api/community/admin/${site.appId}${path}`, owner);

async function approve(approvalId: unknown): Promise<void> {
  const approval = ok(await api.get(`/api/approvals/${approvalId}`, owner));
  ok(
    await api.request('POST', `/api/approvals/${approvalId}/decide`, owner, {
      version: approval.version,
      decision: 'approve',
    }),
  );
  await drain();
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  // MCP는 도구 답의 링크에 사이트 주소를 쓴다: 이 서버의 주소로 정해 둔다
  const space = ok(await api.get('/api/space'));
  ok(
    await api.request('PUT', '/api/space', owner, {
      name: space.name || '돌무더기',
      siteUrl: api.baseUrl,
      version: space.version,
    }),
  );
  runner = String(
    ok(
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: 'review-runner',
      }),
      201,
    ).token,
  );
  ok(await api.request('PUT', '/api/ai/claude/token', owner, { token: `sk-ant-oat01-${mark}` }));
  site = await CommunitySite.open(api, owner, `review-${mark}`);
  writer = await site.member(`rvw${mark}`, `검토글쓴이${mark}`);
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `검토 일꾼 ${mark}`,
      tool: 'claude',
    }),
    201,
  );
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});
after(() => api.close());

describe('신고 검토 (스토어 3-3)', () => {
  test('신고마다 검토 일을 요청하되 대상 · 관리자가 정한 때마다 하나, 담당은 비워 둔다', async () => {
    const id = await topic('검토 하나');
    await report(id, 1);
    await report(id, 1);
    const found = await reviews(id);
    assert.equal(found.length, 1, '신고가 둘이어도 검토 일은 하나');
    assert.equal(found[0]?.agent_id, null);
  });

  test('검토 일의 작업 토큰은 community_case · propose_setting만 보고, 다른 도구 · 다른 설정은 막힌다', async () => {
    const id = await topic('도구 좁히기');
    await report(id, 2);
    const [review] = await reviews(id);
    const token = await lease(String(review?.id));
    const listed = await api.mcp(token, 'tools/list', {});
    const names = ((listed.json().result as Json).tools as Json[]).map((t) => t.name).sort();
    assert.deepEqual(names, ['community_case', 'propose_setting']);
    const blocked = await tool(token, 'get_settings', {});
    assert.equal(blocked.ok, false, '목록에 없는 도구는 부르지 못한다');
    assert.match(String(blocked.body.message), /도구가 없어요/);

    const seen = await tool(token, 'community_case', { app_id: site.appId, topic_id: id });
    assert.equal(seen.ok, true, JSON.stringify(seen.body));
    const target = seen.body.target as Json;
    const author = seen.body.author as Json;
    assert.deepEqual(
      [target.id, target.state, (seen.body.reports as Json[]).length],
      [id, 'shown', 2],
    );
    assert.equal(author.login_id, undefined, '회원의 아이디는 싣지 않는다');
    assert.equal(author.nickname, `검토글쓴이${mark}`);

    const other = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'app',
      op: 'edit',
      target_id: site.appId,
      version: 1,
      fields: { name: '바꾸기' },
    });
    assert.equal(other.ok, false);
    assert.match(String(other.body.message), /moderation만/);

    const stale = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'moderation',
      op: 'update',
      target_id: id,
      version: Number(target.version) + 5,
      fields: { app_id: site.appId, target: 'topic', state: 'removed' },
    });
    assert.equal(stale.ok, false, '낡은 버전은 미리 해 보기에서 걸린다');
  });

  test('글 내림 제안 → 승인 → 관리자 결정과 같은 줄: 내림 · 열린 신고 인정 · 기록은 approved, 검토 일은 끝남', async () => {
    const id = await topic('내릴 글');
    await report(id, 2);
    const [review] = await reviews(id);
    const token = await lease(String(review?.id));
    const seen = await tool(token, 'community_case', { app_id: site.appId, topic_id: id });
    const version = Number((seen.body.target as Json).version);
    const proposed = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'moderation',
      op: 'update',
      target_id: id,
      version,
      fields: { app_id: site.appId, target: 'topic', state: 'removed' },
      note: '욕설 (본문 첫 줄). 신고 2건 모두 욕설.',
    });
    assert.equal(proposed.ok, true, JSON.stringify(proposed.body));
    const approval = ok(await api.get(`/api/approvals/${proposed.body.approval_id}`, owner));
    const changes = approval.changes as Json[];
    assert.deepEqual(
      changes.map((c) => [c.field, c.before, c.after]),
      [
        ['state', 'shown', 'removed'],
        ['open_reports', 2, 0],
      ],
    );
    const before = ok(await admin(`/topics/${id}`));
    assert.equal(before.state, 'shown', '승인 전에는 바뀌지 않는다');

    await approve(proposed.body.approval_id);
    const afterTopic = ok(await admin(`/topics/${id}`));
    assert.equal(afterTopic.state, 'removed');
    const open = ok(await admin('/reports?state=open')).items as Json[];
    assert.equal(JSON.stringify(open).includes(id), false, '열린 신고가 닫혔다');
    const decisions = ok(await admin('/decisions')).items as Json[];
    const mine = decisions.find((d) => (d.target as Json).id === id && d.action === 'remove');
    assert.equal(mine?.by, 'approved');
    const [done] = await reviews(id);
    assert.equal(done?.status, 'done');
  });

  test('회원 차단 제안 → 승인하면 그 회원이 기한 없이 막힌다', async () => {
    const id = await topic('차단할 사람의 글');
    await report(id, 1);
    const [review] = await reviews(id);
    const token = await lease(String(review?.id));
    const seen = await tool(token, 'community_case', { app_id: site.appId, topic_id: id });
    const author = seen.body.author as Json;
    const proposed = await tool(token, 'propose_setting', {
      request_id: randomUUID(),
      setting: 'moderation',
      op: 'update',
      target_id: author.member_id,
      version: author.version,
      fields: { app_id: site.appId, target: 'member', blocked_until: 'forever' },
      note: '사기 광고를 되풀이함',
    });
    assert.equal(proposed.ok, true, JSON.stringify(proposed.body));
    await approve(proposed.body.approval_id);
    const blocked = await site.write(writer, 'POST', '/api/community/topics', {
      requestId: randomUUID(),
      title: '막힌 뒤',
      body: '쓰기',
    });
    assert.equal(blocked.status, 403, blocked.text);
  });
});
