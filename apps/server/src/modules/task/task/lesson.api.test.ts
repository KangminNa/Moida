import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker, SystemActor } from '../../platform';
import { LessonQuery } from './lesson.query';

// 피드백에서 배우기 (2026-11-20, ECC의 continuous-learning에서 가져옴): 관리자가 수정 요청에 남긴 메모가 3개 쌓이면
// 대표에게 "피드백에서 배우기" 일 하나. 열린 배우기 일이 있거나 같은 날이면 더 만들지 않고, 사람이 고친 것만 센다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let runner: string;
let db: Database;
let worker: OutboxWorker;
let leadId: string;
let spaceId: string;
let writer: Json;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent ?? {};
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

/** 글쓰기 에이전트의 일 하나가 공개를 올리고, 관리자가 메모와 함께 수정 요청한다 */
async function revise(note: string, action = 'blog.post.publish'): Promise<string> {
  const made = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: writer.id,
      title: `초안 ${randomUUID().slice(0, 6)}`,
      instruction: '초안을 써 주세요',
    }),
    201,
  );
  const jobs = (await tool(runner, 'next_jobs', { limit: 5 })).jobs as Json[];
  const job = jobs.find((j) => (j.task as Json).id === made.id) as Json;
  assert.ok(job, '글쓰기의 일이 빌려지지 않았다');
  const asked = await tool(String(job.run_token), 'request_approval', {
    request_id: randomUUID(),
    action,
    target_kind: 'post',
    target_id: randomUUID(),
    target_version: 1,
    note: '공개해 주세요',
  });
  const approval = ok(await api.get(`/api/approvals/${asked.approval_id}`, owner));
  ok(
    await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
      version: approval.version,
      decision: 'revise',
      note,
    }),
  );
  await drain();
  return String(approval.id);
}

const lessons = async () =>
  db.sql<{ id: string; agent_id: string; instruction: string; priority: number; status: string }[]>`
    SELECT id, agent_id, instruction, priority, status FROM task.tasks
    WHERE request_id LIKE ${`lessons:${spaceId}:%`} AND request_id NOT LIKE '%:before'
    ORDER BY created_at`;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '배우기', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'lesson-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'lesson-runner');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: [...(device?.scopes ?? []), 'run'],
      version: device?.version,
    }),
  );
  // 대표는 첫 대화에서 생긴다
  ok(
    await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message: '안녕' }),
    201,
  );
  const lead = ok(await api.get('/api/agents/lead', owner)).lead as Json;
  leadId = String(lead.id);
  const [row] = await db.sql<{ space_id: string }[]>`
    SELECT space_id FROM task.agents WHERE id = ${leadId}`;
  spaceId = String(row?.space_id);
  writer = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `글쓰기 ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public', 'write'],
      approvalActions: ['blog.post.publish', 'browser.site.login'],
    }),
    201,
  );
});
after(async () => {
  // 뒤의 테스트 파일이 빌리지 않게 이 파일이 남긴 일(대화 회차 · 배우기 · 되돌아간 초안)을 닫는다
  await db.sql`
    UPDATE task.tasks
    SET status = 'cancelled', finished_at = now(), lease_until = NULL, wait_reason = NULL,
      wait_until = NULL
    WHERE agent_id IN (${leadId}, ${String(writer.id)}) AND status IN ('queued', 'running', 'waiting')`;
  await api.close();
});

describe('피드백에서 배우기', () => {
  test('수정 요청 메모가 3개 쌓이면 대표에게 배우기 일 하나, 열려 있거나 같은 날이면 더 만들지 않는다', async () => {
    // 같은 공간을 쓰는 다른 테스트 파일의 메모 · 배우기 일과 섞이지 않게, 지금까지의 배우기 일을 지금 끝난 것으로 돌린다.
    // 앞 파일들이 배우기 일 없이 메모만 남겼으면 기준이 없어 그 메모까지 세므로 기준이 될 일 하나를 먼저 둔다
    ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: `lessons:${spaceId}:base-${randomUUID()}`,
        agentId: writer.id,
        title: '기준',
        instruction: '기준',
      }),
      201,
    );
    await db.sql`
      UPDATE task.tasks SET status = 'cancelled', finished_at = now(), created_at = now(),
        request_id = request_id || ':before'
      WHERE request_id LIKE ${`lessons:${spaceId}:%`}`;
    await revise('제목은 40자 안으로 줄여 주세요');
    await revise('첫 문단에 결론을 먼저 써 주세요');
    assert.equal((await lessons()).length, 0, '2개로는 아직');

    await revise('제목이 또 길어요. 짧게');
    const [made, ...more] = await lessons();
    assert.equal(more.length, 0);
    assert.equal(made?.agent_id, leadId, '대표에게');
    assert.equal(made?.priority, -5, '대화의 일보다 뒤');
    const text = String(made?.instruction);
    assert.match(text, /^# 피드백에서 배우기/);
    assert.match(text, /최근 수정 요청에 남긴 메모 3개/);
    assert.match(text, /관리자 메모: 제목이 또 길어요\. 짧게/);
    assert.match(text, /올린 에이전트: 글쓰기/);
    assert.ok(text.indexOf('제목이 또 길어요') < text.indexOf('제목은 40자'), '최근 것부터');

    // 배우기 일이 열려 있으면 메모가 더 쌓여도 그대로
    for (const note of ['소제목을 달아 주세요', '이모지는 빼요', '끝맺음을 짧게'])
      await revise(note);
    assert.equal((await lessons()).length, 1);

    // 끝나도 같은 날에는 하나 (공간 · 날마다 일 하나)
    await db.sql`UPDATE task.tasks SET status = 'done', finished_at = now() WHERE id = ${String(made?.id)}`;
    for (const note of ['표는 세 줄 안으로', '날짜는 2026-11-20 꼴로', '링크는 끝에 모아요'])
      await revise(note);
    assert.equal((await lessons()).length, 1);
  });

  test('사람이 고친 것만 센다: 검수자의 수정 요청 · 로그인했어요는 빠지고, since 뒤의 것만', async () => {
    const human = await revise('사람의 메모');
    const inspector = await revise('검수자의 메모');
    await db.sql`UPDATE task.approvals SET agent_decided = true WHERE id = ${inspector}`;
    const login = await revise('로그인했어요', 'browser.site.login');
    const query = api.service(LessonQuery);
    const ids = (await query.notes(new SystemActor(), spaceId, null)).map((n) => n.id);
    assert.ok(ids.includes(human));
    assert.equal(ids.includes(inspector), false, '검수자가 정한 것');
    assert.equal(ids.includes(login), false, '메모가 아닌 신호');
    const later = await query.notes(new SystemActor(), spaceId, new Date(Date.now() + 60_000));
    assert.equal(later.length, 0, 'since 뒤의 것만');
  });
});
