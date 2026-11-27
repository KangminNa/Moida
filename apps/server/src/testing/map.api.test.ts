import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type TestUser } from './api-client';

// 지도 플러그인의 찾기 경로 (docs/지도.md MP-2): /api/p/map/search · geocode · reverse. 방문자도 부른다 (공개 앱의 화면).
// 회사를 실제로 부르는 것은 plugins/map/server/map-search.test.ts(테스트용 웹 서버)가 보고, 여기서는 켜기 · 설정 · 입력 · 비밀을 본다

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  const on = await api.request('POST', '/api/plugins/map/enable', owner);
  assert.equal(on.status, 200, on.text);
});
after(() => api.close());

const settings = (values: Json) =>
  api.request('PUT', '/api/plugins/map/settings', owner, { values });

describe('지도 찾기 (/api/p/map)', () => {
  test('찾기 회사를 고르지 않았으면 방문자에게 404, 입력이 틀리면 400과 칸', async () => {
    const off = await api.get('/api/p/map/search?q=%EB%B9%B5%EC%A7%91');
    assert.equal(off.status, 404, off.text);
    assert.match(String((off.json() as Json).message), /켜지 않았어요/);
    const bad = await api.get('/api/p/map/search?q=%EB%B9%B5&lat=91&lng=0');
    assert.equal(bad.status, 400, bad.text);
    assert.ok(((bad.json() as Json).fields as Json).lat);
    assert.equal((await api.get('/api/p/map/reverse')).status, 400);
  });

  test('서버 키는 공개 설정에 나가지 않고, 키가 비었거나 구글을 구글 지도 없이 고르면 꺼진 것과 같다', async () => {
    assert.equal(
      (await settings({ searchProvider: 'kakao', kakaoRestKey: 'KAKAO-REST-SECRET' })).status,
      200,
    );
    const shown = await api.get('/api/plugins/map/settings');
    assert.equal(shown.status, 200, shown.text);
    assert.equal(shown.text.includes('KAKAO-REST-SECRET'), false);
    assert.equal((shown.json() as { settings: Json }).settings.searchProvider, undefined);

    assert.equal((await settings({ searchProvider: 'naver', naverClientSecret: 's' })).status, 200);
    const noId = await api.get('/api/p/map/geocode?address=%EC%84%B8%EC%A2%85%EB%8C%80%EB%A1%9C');
    assert.equal(noId.status, 404, '네이버는 Client ID도 있어야 한다');

    assert.equal(
      (await settings({ searchProvider: 'google', googleServerKey: 'g', provider: 'osm' })).status,
      200,
    );
    const google = await api.get('/api/p/map/search?q=%EB%B9%B5');
    assert.equal(google.status, 404, '구글 찾기는 구글 지도와 함께만');
  });

  test('사용량은 관리자만: 방문자 403, 관리자는 회사 · 켜짐 · 오늘 · 한도', async () => {
    assert.equal((await settings({ searchProvider: 'kakao', dailyLimit: '200' })).status, 200);
    const visitor = await api.get('/api/p/map/usage');
    assert.equal(visitor.status === 401 || visitor.status === 403, true, visitor.text);
    const usage = await api.request('GET', '/api/p/map/usage', owner);
    assert.equal(usage.status, 200, usage.text);
    const body = usage.json() as Json;
    assert.equal(body.provider, 'kakao');
    assert.equal(body.ready, true);
    assert.equal(body.limit, 200);
    assert.equal(typeof body.today, 'number');
  });

  test('일꾼 도구 map_geocode: 일을 쥔 에이전트만 부르고, write 기기는 거절된다', async () => {
    assert.equal((await settings({ searchProvider: 'none' })).status, 200);
    const device = await api.writeDevice(owner, `지도 기기 ${randomUUID().slice(0, 6)}`);
    const byDevice = await tool(device, 'map_geocode', { addresses: ['세종대로 110'] });
    assert.equal(byDevice.ok, false, '기기는 바깥 회사로 주소를 보내지 못한다');

    const token = await agentToken();
    const off = await tool(token, 'map_geocode', { addresses: ['세종대로 110'] });
    assert.equal(off.ok, false);
    assert.match(JSON.stringify(off.body), /켜지 않았어요/, '찾기를 켜지 않았으면 거절');
    const bad = await tool(token, 'map_geocode', { addresses: [] });
    assert.equal(bad.ok, false);
  });
});

async function tool(token: string, name: string, args: Json) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = (res.json() as { result: Json }).result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') as Json }
    : { ok: true, body: (result.structuredContent ?? {}) as Json };
}

/** 대표에게 일을 하나 맡기고 러너가 빌려 그 일의 작업 토큰을 받는다 */
async function agentToken(): Promise<string> {
  const made = await api.request('POST', '/api/devices/runner', owner, {
    requestId: randomUUID(),
    name: `지도 러너 ${randomUUID().slice(0, 6)}`,
  });
  assert.equal(made.status, 201, made.text);
  const runner = String((made.json() as Json).token);
  const ai = await api.request('PUT', '/api/ai/claude/token', owner, {
    token: `sk-ant-oat01-${randomUUID()}`,
  });
  assert.equal(ai.status, 200, ai.text);
  let lead = (await api.get('/api/agents/lead', owner)).json() as { lead: Json | null };
  if (!lead.lead) {
    await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message: '시작' });
    lead = (await api.get('/api/agents/lead', owner)).json() as { lead: Json | null };
  }
  const task = await api.request('POST', '/api/tasks', owner, {
    requestId: randomUUID(),
    agentId: lead.lead?.id,
    instruction: '맛집 앱의 주소 확인',
  });
  assert.equal(task.status, 201, task.text);
  const taskId = (task.json() as Json).id;
  for (let round = 0; round < 20; round++) {
    const next = await tool(runner, 'next_jobs', { wait_seconds: 0, limit: 10, tools: ['claude'] });
    const job = (next.body.jobs as Json[]).find((j) => (j.task as Json).id === taskId);
    if (job) return String(job.run_token);
  }
  throw new Error('빌린 일이 없다');
}
