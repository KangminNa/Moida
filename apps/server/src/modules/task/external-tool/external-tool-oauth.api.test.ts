import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, Outbox, OutboxWorker, SecretBox } from '../../platform';
import { ExternalToolRefreshJob } from './external-tool-refresh.job';

// OAuth 커넥터 (C1): 로그인 시작 → 로그인 서버의 승인(가짜) → 돌아옴 → 잠근 토큰 → next_jobs의 Bearer → 일꾼의 갱신 · 거절.
// 바깥 로그인 서버 대신 127.0.0.1의 가짜 서버를 쓴다: OAuthGateway의 시험 스위치를 켜면 루프백 주소를 그대로 적은 https 주소를
// http로 연다. 커넥터 주소의 규칙(ExternalToolUrl)은 IP를 받지 않아서 가짜 서버의 주소는 SQL로 넣는다 (DB의 https CHECK는 지난다).
// 관리자는 REST로, 러너는 MCP로 들어온다. AI는 띄우지 않는다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;
/** OAuthGateway.TEST_LOOPBACK_ENV (모듈 안을 가져오지 않으려고 이름만) */
const LOOPBACK = 'CAIRN_OAUTH_TEST_LOOPBACK';
const CALLBACK = '/api/external-tools/oauth/callback';

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let runner: string;
let writer: Readonly<Record<string, string>>;
let fake: Server;
/** 가짜 로그인 서버의 출처 (https로 적지만 시험 스위치로 http로 열린다) */
let base: string;

/** 가짜 로그인 서버가 받은 것과 줄 것 */
const registered: Json[] = [];
const tokenCalls: Record<string, string>[] = [];
const codes = new Map<
  string,
  { challenge: string; client: string; redirect: string; resource: string }
>();
const refreshTokens = new Set<string>();
let generation = 1;
let refuseRefresh = false;
/** 일꾼을 깨우는 신호 (Outbox.CHANNEL) */
const heard: string[] = [];
let listener: ReturnType<Database['listen']>;

/** 이 마감 작업을 깨우는 신호가 왔다 (connect가 확인 · 갱신을 깨운다) */
async function woke(job: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!heard.includes(Outbox.DUE + job)) {
    assert.ok(Date.now() < deadline, `${job}을(를) 깨우지 않았어요: ${JSON.stringify(heard)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.status === 204 ? {} : res.json();
}

async function call(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  const result = res.json().result as Json;
  assert.equal(result.isError ?? false, false, res.text);
  return result.structuredContent as Json;
}

const listed = async (): Promise<Json[]> =>
  ok(await api.get('/api/external-tools', owner)).tools as Json[];
const one = async (id: unknown): Promise<Json> => (await listed()).find((t) => t.id === id) as Json;
const start = (id: unknown, version: unknown, as = owner, headers: Json = {}) =>
  api.request('POST', `/api/external-tools/${id}/oauth/start`, as, { version }, headers);
const callback = (query: string, as = owner, headers: Json = {}) =>
  api.request('GET', `${CALLBACK}?${query}`, as, undefined, headers);

/** 로그인 서버의 승인 화면이 하는 일: 주소를 읽고 승인 코드를 내준다 */
function authorize(url: string): { code: string; state: string; query: Record<string, string> } {
  const query = Object.fromEntries(new URL(url).searchParams);
  const code = `code-${randomUUID()}`;
  codes.set(code, {
    challenge: query.code_challenge ?? '',
    client: query.client_id ?? '',
    redirect: query.redirect_uri ?? '',
    resource: query.resource ?? '',
  });
  return { code, state: query.state ?? '', query };
}

/** OAuth 커넥터 하나를 만들고 주소를 가짜 서버로 돌린다 */
async function oauthTool(name: string): Promise<Json> {
  const made = ok(
    await api.request('POST', '/api/external-tools', owner, {
      requestId: randomUUID(),
      name,
      title: `로그인 ${name}`,
      url: 'https://mcp.example.com/mcp',
      auth: 'oauth',
      headerName: 'Authorization',
    }),
    201,
  );
  await db.sql`UPDATE task.external_tools SET url = ${`${base}/mcp`} WHERE id = ${made.id}`;
  return one(made.id);
}

/** 시작 → 승인 → 돌아옴까지. 돌아온 주소를 돌려준다 */
async function login(tool: Json): Promise<string | null> {
  const { url } = ok(await start(tool.id, (await one(tool.id)).version));
  const { code, state } = authorize(url);
  const back = await callback(`code=${code}&state=${state}`);
  assert.equal(back.status, 302, back.text);
  return back.location;
}

/** 이 에이전트에게 일을 맡기고 러너가 빌린다 */
async function take(agentId: unknown): Promise<Json> {
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId,
      instruction: '노션에서 찾기',
    }),
    201,
  );
  for (let i = 0; i < 50; i++) {
    const { jobs } = (await call(runner, 'next_jobs')) as { jobs: Json[] };
    const mine = jobs.find((j) => j.task.id === task.id);
    if (mine) return mine;
    if (jobs.length === 0) break;
  }
  throw new Error('맡긴 일을 빌리지 못했어요');
}

function json(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** 가짜 로그인 서버: 보호된 자원 정보 · 로그인 서버 정보 · 동적 등록 · 토큰 (PKCE를 실제로 맞춰 본다) */
async function fakeAuth(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const text = await bodyOf(req);
  if (path === '/.well-known/oauth-protected-resource/mcp')
    return json(res, 200, {
      resource: `${base}/mcp`,
      authorization_servers: [`${base}/auth`],
      scopes_supported: ['read', 'write'],
    });
  if (path === '/.well-known/oauth-authorization-server/auth')
    return json(res, 200, {
      issuer: `${base}/auth`,
      authorization_endpoint: `${base}/auth/authorize`,
      token_endpoint: `${base}/auth/token`,
      registration_endpoint: `${base}/auth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  if (req.method === 'POST' && path === '/auth/register') {
    registered.push(JSON.parse(text));
    return json(res, 201, { client_id: 'client-1', client_secret: 'never-used' });
  }
  if (req.method === 'POST' && path === '/auth/token') {
    const form = Object.fromEntries(new URLSearchParams(text));
    tokenCalls.push(form);
    if (form.grant_type === 'authorization_code') {
      const kept = codes.get(form.code ?? '');
      codes.delete(form.code ?? '');
      const verified =
        kept &&
        createHash('sha256')
          .update(form.code_verifier ?? '')
          .digest('base64url') === kept.challenge &&
        form.client_id === kept.client &&
        form.redirect_uri === kept.redirect &&
        form.resource === kept.resource;
      if (!verified) return json(res, 400, { error: 'invalid_grant' });
      refreshTokens.add('rt-1');
      return json(res, 200, {
        access_token: 'at-1',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rt-1',
      });
    }
    if (
      form.grant_type === 'refresh_token' &&
      !refuseRefresh &&
      refreshTokens.delete(form.refresh_token ?? '')
    ) {
      generation += 1;
      refreshTokens.add(`rt-${generation}`);
      return json(res, 200, {
        access_token: `at-${generation}`,
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: `rt-${generation}`,
      });
    }
    return json(res, 400, {
      error: 'invalid_grant',
      error_description: 'refresh token rt-secret is gone',
    });
  }
  json(res, 404, { error: 'not_found' });
}

before(async () => {
  process.env[LOOPBACK] = '1';
  fake = createServer((req, res) => void fakeAuth(req, res));
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
  base = `https://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  listener = db.listen(Outbox.CHANNEL, (payload) => {
    heard.push(payload);
  });
  await listener.ready;
  // write 기기를 연결하면서 사이트 주소를 이 서버로 정한다: 돌아올 주소가 된다
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'oauth-writer')}` };
  runner = await api.connectDevice(owner, 'oauth-runner');
  const { devices } = ok(await api.get('/api/devices', owner));
  const device = (devices as Json[]).find((d) => d.name === 'oauth-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
});

after(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
  await db.sql`UPDATE task.agents SET status = 'paused' WHERE NOT lead`; // 대표(O-2)는 뒤 파일의 대화가 쓴다
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  await listener.stop();
  await api.close();
  await new Promise((done) => fake.close(done));
  delete process.env[LOOPBACK];
});

describe('OAuth 커넥터 (/api/external-tools/:id/oauth, C1)', () => {
  test('방문자와 write 기기는 로그인을 시작하지도 끝내지도 못한다 (403)', async () => {
    const tool = await oauthTool('oauth-denied');
    for (const headers of [{}, writer]) {
      const started = await start(tool.id, tool.version, TestUser.visitor, headers);
      assert.equal(started.status, 403, started.text);
      const back = await callback(
        `code=x&state=${tool.id}.${'a'.repeat(43)}`,
        TestUser.visitor,
        headers,
      );
      assert.equal(back.status, 403, back.text);
    }
  });

  test('토큰 방식 커넥터 · 낡은 버전은 로그인을 시작하지 않는다', async () => {
    const header = ok(
      await api.request('POST', '/api/external-tools', owner, {
        requestId: randomUUID(),
        name: 'oauth-header',
        title: '토큰 방식',
        url: 'https://mcp.example.com/mcp',
      }),
      201,
    );
    assert.equal(header.auth, 'header');
    assert.equal(header.oauth, null);
    assert.equal((await start(header.id, header.version)).status, 422);
    const tool = await oauthTool('oauth-stale');
    assert.equal((await start(tool.id, tool.version + 1)).status, 409);
  });

  test('시작 → 승인 → 돌아옴: 토큰은 잠겨 화면에 나오지 않고, 허락한 에이전트의 일에 Bearer로 간다', async () => {
    const tool = await oauthTool('oauth-notion');
    assert.equal(tool.auth, 'oauth');
    assert.equal(tool.headerName, null, 'OAuth 커넥터는 머리글을 쓰지 않는다');
    assert.deepEqual(tool.oauth, {
      connected: false,
      needsLogin: true,
      expiresAt: null,
      error: null,
      issuer: null,
    });

    const { url } = ok(await start(tool.id, tool.version));
    assert.ok(url.startsWith(`${base}/auth/authorize?`), url);
    const { code, state, query } = authorize(url);
    assert.equal(query.response_type, 'code');
    assert.equal(query.client_id, 'client-1');
    assert.equal(query.redirect_uri, `${api.baseUrl}${CALLBACK}`);
    assert.equal(query.code_challenge_method, 'S256');
    assert.match(query.code_challenge ?? '', /^[A-Za-z0-9_-]{43}$/);
    assert.ok(state.startsWith(`${tool.id}.`), state);
    assert.equal(query.resource, `${base}/mcp`);
    assert.equal(query.scope, 'read write');
    const [registration] = registered;
    assert.equal(registration?.token_endpoint_auth_method, 'none');
    assert.deepEqual(registration?.redirect_uris, [`${api.baseUrl}${CALLBACK}`]);
    assert.deepEqual(registration?.grant_types, ['authorization_code', 'refresh_token']);

    heard.length = 0;
    const back = await callback(
      `code=${code}&state=${state}&iss=${encodeURIComponent(`${base}/auth`)}`,
    );
    assert.equal(back.status, 302, back.text);
    assert.equal(back.location, `/admin/external-tools?connected=${tool.id}`);
    await woke('task.external_tools.check'); // 연결하면 확인을 다시 맡긴다
    await woke('task.external_tools.refresh'); // 갱신할 때를 다시 잰다
    const exchange = tokenCalls.at(-1) as Record<string, string>;
    assert.equal(exchange.grant_type, 'authorization_code');
    assert.equal(exchange.resource, `${base}/mcp`);

    const list = await api.get('/api/external-tools', owner);
    for (const secret of ['at-1', 'rt-1', exchange.code_verifier, 'client-1', 'never-used', state])
      assert.equal(list.text.includes(secret as string), false, `화면에 나오지 않는다: ${secret}`);
    const connected = await one(tool.id);
    assert.equal(connected.oauth.connected, true);
    assert.equal(connected.oauth.needsLogin, false);
    assert.equal(connected.oauth.issuer, `${base}/auth`);
    assert.ok(Date.parse(connected.oauth.expiresAt) > Date.now() + 50 * 60_000);
    const [stored] = await db.sql<{ token: Buffer; oauth_pending: string | null; auth: string }[]>`
      SELECT token, oauth_pending, auth FROM task.external_tools WHERE id = ${tool.id}`;
    assert.equal(stored?.token.includes('at-1'), false, '토큰은 잠겨 있다');
    assert.equal(stored?.oauth_pending, null, '돌아오면 state를 지운다');

    const agent = ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: `노션 ${randomUUID().slice(0, 6)}`,
        tool: 'claude',
        scopes: ['read_public'],
        externalTools: ['oauth-notion'],
      }),
      201,
    );
    const job = await take(agent.id);
    const handed = (job.tools as Json[]).find((t) => t.name === 'oauth-notion');
    assert.deepEqual(handed?.headers, { Authorization: 'Bearer at-1' });
    assert.equal(handed?.url, `${base}/mcp`);

    // 주소를 바꾸면 그 로그인 서버의 토큰 · 등록을 지운다 (다시 로그인해야 붙는다)
    const moved = ok(
      await api.request('PATCH', `/api/external-tools/${tool.id}`, owner, {
        version: (await one(tool.id)).version,
        url: 'https://mcp2.example.com/mcp',
      }),
    );
    assert.deepEqual(moved.oauth, {
      connected: false,
      needsLogin: true,
      expiresAt: null,
      error: null,
      issuer: null,
    });
    const gone = ((await take(agent.id)).tools as Json[]).find((t) => t.name === 'oauth-notion');
    assert.equal(gone, undefined);
  });

  test('맞지 않는 · 이미 쓴 · 10분 지난 state와 취소는 화면으로 돌려보내고 토큰을 받지 않는다', async () => {
    const tool = await oauthTool('oauth-state');
    const reason = (res: ApiResult) => {
      assert.equal(res.status, 302, res.text);
      return new URL(res.location ?? '', 'http://x').searchParams.get('oauth_error');
    };
    const first = authorize(ok(await start(tool.id, tool.version)).url);
    assert.equal(
      reason(await callback(`code=${first.code}&state=${tool.id}.${'b'.repeat(43)}`)),
      'state',
    );
    assert.equal(reason(await callback(`code=${first.code}&state=nonsense`)), 'state');
    assert.equal(
      reason(
        await callback(`code=${first.code}&state=${first.state}&iss=https://evil.example.com`),
      ),
      'state',
    );
    assert.equal(
      reason(await callback(`code=${first.code}&state=${first.state}`)),
      'state',
      '앞의 iss가 이미 썼다',
    );

    const denied = authorize(ok(await start(tool.id, (await one(tool.id)).version)).url);
    assert.equal(reason(await callback(`error=access_denied&state=${denied.state}`)), 'denied');
    assert.equal(
      reason(await callback(`code=${denied.code}&state=${denied.state}`)),
      'state',
      '취소한 state도 한 번',
    );

    const late = authorize(ok(await start(tool.id, (await one(tool.id)).version)).url);
    const expired = SecretBox.fromEnv(process.env).pack(
      `external-tool-oauth:${tool.id}`,
      `${late.state} verifier`,
      0,
    );
    await db.sql`UPDATE task.external_tools SET oauth_pending = ${expired} WHERE id = ${tool.id}`;
    assert.equal(reason(await callback(`code=${late.code}&state=${late.state}`)), 'state');

    const wrong = authorize(ok(await start(tool.id, (await one(tool.id)).version)).url);
    codes.delete(wrong.code);
    assert.equal(
      reason(await callback(`code=${wrong.code}&state=${wrong.state}`)),
      'token',
      '로그인 서버가 거절',
    );
    const failed = await one(tool.id);
    assert.equal(failed.oauth.connected, false);
    assert.match(failed.oauth.error, /invalid_grant/, '받지 못한 까닭은 커넥터에 남는다');
  });

  test('일꾼이 끝나 가는 토큰을 갱신하고, 거절되면 로그인 필요로 두고 건네지 않는다', async () => {
    const tool = await oauthTool('oauth-refresh');
    assert.equal(await login(tool), `/admin/external-tools?connected=${tool.id}`);
    const agent = ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: `갱신 ${randomUUID().slice(0, 6)}`,
        tool: 'claude',
        scopes: ['read_public'],
        externalTools: ['oauth-refresh'],
      }),
      201,
    );
    const refreshJob = api.service(ExternalToolRefreshJob);
    const due = async () => {
      await db.sql`
        UPDATE task.external_tools SET token_refresh_at = now() - interval '1 second' WHERE id = ${tool.id}`;
      return refreshJob.run(new Date());
    };

    const versionBefore = (await one(tool.id)).version;
    const next = await due();
    const renewed = tokenCalls.at(-1) as Record<string, string>;
    assert.equal(renewed.grant_type, 'refresh_token');
    assert.equal(renewed.client_id, 'client-1');
    assert.equal(renewed.resource, `${base}/mcp`);
    assert.ok(next !== null && next.getTime() > Date.now(), '다음 갱신은 앞으로');
    const after = await one(tool.id);
    assert.equal(after.oauth.connected, true);
    assert.equal(
      after.version,
      versionBefore,
      '갱신은 버전을 올리지 않는다 (관리자의 고치기와 겨루지 않게)',
    );
    const handed = ((await take(agent.id)).tools as Json[]).find((t) => t.name === 'oauth-refresh');
    assert.deepEqual(handed?.headers, { Authorization: `Bearer at-${generation}` });

    refuseRefresh = true;
    await due();
    const lost = await one(tool.id);
    assert.equal(lost.oauth.connected, false);
    assert.equal(lost.oauth.needsLogin, true);
    assert.match(lost.oauth.error, /invalid_grant/);
    assert.equal(
      String(lost.oauth.error).includes('rt-secret'),
      false,
      '바깥 답의 글은 싣지 않는다',
    );
    const none = ((await take(agent.id)).tools as Json[]).find((t) => t.name === 'oauth-refresh');
    assert.equal(none, undefined, '로그인이 풀린 커넥터는 건네지 않는다');
    refuseRefresh = false;
  });
});
