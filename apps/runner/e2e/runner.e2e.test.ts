import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ServerRunnerPolicy } from '../../server/src/modules/account/device/server-runner.policy';
import { Database, OutboxWorker } from '../../server/src/modules/platform';
import { ApiClient, type ApiResult, type TestUser } from '../../server/src/testing/api-client';
import { FakeGithubApi } from '../src/testing/fake-github-api';
import { GitServer } from '../src/testing/git-server';
import { TestChromium } from '../src/testing/test-chromium';

// 러너 전체: 실제 서버, 실제 러너 프로세스, 표준 입출력만 흉내 낸 가짜 AI CLI (fake-claude.mjs).
// 진짜 claude는 쓰지 않는다. 주인은 REST로, 러너는 MCP로만 들어온다.
//
// 러너 하나를 띄워 두고 계속 쓴다. 테스트마다 러너를 끄고 켜면 안 된다: 끊긴 next_jobs도 서버는 시간이 다 될 때까지 찾아서
// 다음 테스트의 일을 사라진 러너에게 빌려 준다 (stop의 설명). 멈추는 동작은 맨 뒤에서 따로 본다.

type Json = Record<string, unknown>;

const FAKE_CLI = resolve(__dirname, 'fake-claude.mjs');
const FAKE_CODEX = resolve(__dirname, 'fake-codex.mjs');
const RUNNER_MAIN = resolve(__dirname, '../src/main.ts');
const OAUTH_TOKEN = `claude-${randomUUID()}`;
/** 가짜 CLI의 assistant 줄이 낸 420에 result의 합계가 7을 더한다 */
const FAKE_TOKENS = 427;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** run 권한을 준 기기의 토큰 */
let deviceToken: string;
let spyDir: string;
/** 이 프로세스의 러너들. 테스트가 실패해도 끝에서 끈다 */
const started = new Set<RunnerProcess>();

/** 실행 중인 러너 프로세스 하나. 로그를 모은다 */
class RunnerProcess {
  private output = '';
  private readonly ended: Promise<number | null>;

  constructor(private readonly child: ChildProcess) {
    const collect = (chunk: Buffer) => {
      this.output += chunk.toString('utf8');
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    this.ended = new Promise((done) => child.once('exit', (code) => done(code)));
    started.add(this);
  }

  /** 서버의 cwd 기준으로 swc를 찾으므로 apps/server에서 띄운다 */
  static start(url: string, env: Json = {}): RunnerProcess {
    return new RunnerProcess(
      spawn(process.execPath, ['-r', '@swc-node/register', RUNNER_MAIN], {
        env: {
          PATH: process.env.PATH,
          // swc가 쓰는 캐시 자리. AI CLI는 빈 홈을 받아야 한다
          HOME: process.env.HOME,
          // AI CLI에게 가면 안 되는 값
          DATABASE_URL: process.env.DATABASE_URL,
          MOIDA_RUNNER_URL: url,
          MOIDA_RUNNER_TOKEN: deviceToken,
          MOIDA_RUNNER_CLI: FAKE_CLI,
          MOIDA_RUNNER_CODEX_CLI: FAKE_CODEX,
          CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN,
          // 결과 화면 찍기는 result-shots.test가 본다. Chromium이 있는 컴퓨터에서도 만들기 일의 검사 목록이 같게 끈다
          MOIDA_SHOT_CHROMIUM: 'off',
          ...env,
        } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  }

  get logs(): string {
    return this.output;
  }

  logged(text: string, waitMs?: number): Promise<boolean> {
    return until(`로그: ${text}`, () => (this.output.includes(text) ? true : null), waitMs);
  }

  exited(): Promise<number | null> {
    return this.ended;
  }

  signal(signal: NodeJS.Signals): void {
    this.child.kill(signal);
  }

  stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<number | null> {
    this.signal(signal);
    return this.ended;
  }
}

/** 러너와 서버 사이의 앞단. 평소에는 그대로 넘기고, 알려 준 도구의 응답을 한 번씩 잃어버린다 */
class LossyProxy {
  readonly lost = new Set<string>();
  private armed: readonly string[] = [];
  private server: Server | null = null;

  constructor(private readonly target: string) {}

  async start(): Promise<string> {
    const server = createServer((req, res) => void this.forward(req, res));
    this.server = server;
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  /** 요청은 서버까지 보내고 응답만 끊는다. 러너는 보내지 못한 줄 안다 */
  loseNext(tools: readonly string[]): void {
    this.armed = tools;
  }

  close(): void {
    this.server?.close();
    this.server?.closeAllConnections();
  }

  private async forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    // 바이트 그대로 넘긴다 (결과물 파일은 글자가 아니다). 끊을지는 글자로 본다
    const raw = Buffer.concat(chunks);
    const body = raw.toString('utf8');
    const answer = await fetch(`${this.target}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(raw.length > 0 ? { body: raw } : {}),
    });
    // 응답도 바이트 그대로 (내려받는 사진은 글자가 아니다: 글자로 읽으면 sha256이 어긋난다)
    const answered = Buffer.from(await answer.arrayBuffer());
    if (this.losing(body)) {
      req.socket.destroy();
      return;
    }
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(answered);
  }

  /** 빈 보고는 토큰이 없어 볼 것이 없다. 기록이 든 보고만 잃는다 */
  private losing(body: string): boolean {
    // MCP가 아닌 요청(결과물 파일 본문)은 끊지 않는다
    if (!body.startsWith('{')) return false;
    const { method, params } = JSON.parse(body) as {
      method: string;
      params: { name: string; arguments: Json };
    };
    if (method !== 'tools/call' || !this.armed.includes(params.name)) return false;
    if (params.name === 'report_progress' && !params.arguments.request_id) return false;
    this.armed = this.armed.filter((tool) => tool !== params.name);
    this.lost.add(params.name);
    return true;
  }
}

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const newAgent = async (more: Json = {}): Promise<Json> =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '글쓰기',
      role: '블로그 글을 쓴다',
      tool: 'claude',
      scopes: ['read_public', 'write'],
      approvalActions: ['blog.post.publish'],
      ...more,
    }),
    201,
  );

/** 대표 (O-2). 없으면 첫 대화를 열어 만든다 */
/** 일을 받을 수 있는 대표. 없으면 첫 대화로 만들고, 앞 테스트(연결 확인)가 에이전트를 모두 멈춰 뒀으면 다시 움직인다 */
async function leadOf(): Promise<Json> {
  const current = async () => ok(await api.get('/api/agents/lead', owner)).lead as Json | null;
  let lead = await current();
  if (!lead) {
    ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '대표를 만드는 첫 대화',
      }),
      201,
    );
    lead = (await current()) as Json;
  }
  if (lead.status === 'paused') {
    ok(
      await api.request('POST', `/api/agents/${lead.id}/resume`, owner, { version: lead.version }),
    );
    lead = (await current()) as Json;
  }
  return lead;
}

/**
 * 맡기기는 대표만 한다 (2026-11-21). 대표의 지시문에는 지우지 않은 일꾼이 모두 실리고 테스트용 CLI는 그 모두(나누기는 첫 일꾼)에게
 * 맡기므로, keep 밖의 일꾼을 잠깐 휴지통에 넣는다. 돌려 놓는 함수를 준다 (뒤 테스트의 일꾼은 그대로 쓴다)
 */
async function onlyWorkers(keep: readonly Json[]): Promise<() => Promise<void>> {
  const ids = keep.map((a) => String(a.id));
  const hidden = await db.sql<{ id: string }[]>`
    UPDATE task.agents SET deleted_at = now()
    WHERE NOT lead AND deleted_at IS NULL AND NOT (id = ANY(${ids}::uuid[]))
    RETURNING id`;
  const back = hidden.map((r) => r.id);
  return async () => {
    await db.sql`UPDATE task.agents SET deleted_at = NULL WHERE id = ANY(${back}::uuid[])`;
  };
}

/** 지시문의 표시로 가짜 CLI가 할 일을 정한다 */
const newTask = async (agent: Json, marks: string, more: Json = {}): Promise<Json> =>
  ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      instruction: `글을 써 주세요 ${marks}`,
      ...more,
    }),
    201,
  );

const getTask = async (id: unknown): Promise<Json> => ok(await api.get(`/api/tasks/${id}`, owner));

/** 관리자가 올린 사진 (결과물, 대화에 사진 넣기). PNG 표시 + 아무 바이트 */
const uploadPhoto = async (name: string): Promise<{ id: string; bytes: Buffer }> => {
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    randomBytes(64),
  ]);
  const res = await fetch(`${api.baseUrl}/api/outputs/files?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', cookie: owner.header },
    body: bytes,
  });
  assert.equal(res.status, 201, await res.clone().text());
  return { id: String(((await res.json()) as Json).id), bytes };
};
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const cancelTask = async (task: Json): Promise<void> => {
  const { version } = await getTask(task.id);
  ok(await api.request('POST', `/api/tasks/${task.id}/cancel`, owner, { version }));
};

async function until<T>(
  what: string,
  read: () => Promise<T | null> | T | null,
  waitMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    const logs = [...started].map((r) => r.logs.slice(-1500)).join('\n---\n');
    assert.ok(Date.now() < deadline, `기다렸지만 오지 않음: ${what}\n${logs}`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

const taskIn = (id: unknown, status: string): Promise<Json> =>
  until(`작업이 ${status}`, async () => {
    const task = await getTask(id);
    return task.status === status ? task : null;
  });

/** 가짜 CLI가 적은 것 */
class Spy {
  readonly path = join(spyDir, `${randomUUID()}.json`);

  get mark(): string {
    return `[fake:spy=${this.path}]`;
  }

  async seen(): Promise<Json> {
    return until('가짜 CLI가 뜸', () => {
      if (!existsSync(this.path)) return null;
      try {
        return JSON.parse(readFileSync(this.path, 'utf8')) as Json;
      } catch {
        return null; // 쓰는 중
      }
    });
  }
}

/** 가짜 CLI가 몇 번 떴는지 (fake:runs) */
class Runs {
  readonly path = join(spyDir, `${randomUUID()}.runs`);

  get mark(): string {
    return `[fake:runs=${this.path}]`;
  }

  /** 뜬 AI CLI의 pid들 (뜬 차례로) */
  pids(): string[] {
    return existsSync(this.path) ? readFileSync(this.path, 'utf8').split('\n').filter(Boolean) : [];
  }

  count(): number {
    return this.pids().length;
  }
}

const alive = (pid: unknown): boolean => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
};

const gone = (pid: unknown): Promise<boolean> =>
  until('AI CLI가 꺼짐', () => (alive(pid) ? null : true));

const events = (task: Json): Json[] => task.events as Json[];
const kinds = (task: Json): unknown[] => events(task).map((e) => e.kind);
const tokens = (task: Json): number => events(task).reduce((sum, e) => sum + Number(e.tokens), 0);

before(async () => {
  chmodSync(FAKE_CLI, 0o755);
  chmodSync(FAKE_CODEX, 0o755);
  spyDir = mkdtempSync(join(tmpdir(), 'moida-e2e-'));
  // 결과물: 시험 컴퓨터의 디스크가 작아도 받게 (기본은 20GB를 늘 남긴다)
  process.env.MOIDA_DISK_RESERVE_GB = '0';
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '러너', siteUrl: api.baseUrl, version });
  await api.connectDevice(owner, 'e2e-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'e2e-runner');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: [...(device?.scopes ?? []), 'run'],
      version: device?.version,
    }),
  );
  const spare = ok(await api.request('POST', `/api/devices/${device?.id}/token`, owner));
  deviceToken = String(spare.token);
});

beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL, wait_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

after(async () => {
  for (const runner of started) runner.signal('SIGKILL');
  await api.close();
  rmSync(spyDir, { recursive: true, force: true });
});

describe('러너가 일을 처리한다', () => {
  let proxy: LossyProxy;
  let proxyUrl: string;
  let runner: RunnerProcess;

  before(async () => {
    proxy = new LossyProxy(api.baseUrl);
    proxyUrl = await proxy.start();
    runner = RunnerProcess.start(proxyUrl);
    await runner.logged('러너를 시작했어요');
  });

  after(async () => {
    assert.equal(await runner.stop(), 0);
    proxy.close();
  });

  test('작업을 만들면 러너가 맡아 기록을 남기고 done으로 끝낸다', async () => {
    const agent = await newAgent();
    const created = await newTask(agent, '');

    const task = await taskIn(created.id, 'done');

    assert.deepEqual(task.result, { text: '초안을 저장했어요' });
    assert.deepEqual(kinds(task), ['read', 'write', 'error', 'result', 'result']);
    assert.equal(events(task)[0]?.body, 'Read notes.md');
    assert.equal(events(task)[1]?.body, 'blog_save_draft');
    assert.equal(tokens(task), FAKE_TOKENS);
    assert.equal(JSON.stringify(task).includes('본문은 기록에 남기지 않는다'), false);
    // 실행 기록: 어떤 규칙으로 돌았는지 (스킬 판 · CLI 버전 · 러너가 처음 알린 모델)
    const runs = task.runs as Json[];
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.seq, 1);
    assert.equal(runs[0]?.agentRevision, 1);
    assert.equal(runs[0]?.cliVersion, '2.1.302 (Claude Code)');
    assert.equal(runs[0]?.model, 'fake');
    assert.ok(String(runs[0]?.runnerBuild).length > 0);
    assert.equal(
      (runs[0]?.skill as { name?: string } | null)?.name,
      'moida-work',
      '일반 작업은 moida-work (2026-11-23)',
    );
  });

  test('outputs 폴더의 파일을 결과물로 올린다: 숨김 파일 · 폴더는 빼고 실행 기록에 남긴다', async () => {
    const created = await newTask(await newAgent(), '[fake:outputs]');
    const task = await taskIn(created.id, 'done');
    const outputs = task.outputs as Json[];
    assert.deepEqual(outputs.map((o) => o.name).sort(), ['chart.png', '보고서.md']);
    const chart = outputs.find((o) => o.name === 'chart.png');
    assert.deepEqual([chart?.kind, chart?.runSeq], ['image', 1]);
    const bodies = events(task).map((e) => String(e.body));
    assert.ok(bodies.includes('결과물 2개를 올렸어요'), bodies.join('\n'));
    assert.ok(bodies.some((b) => b.includes('.secret')));
    assert.ok(bodies.some((b) => b.includes('nested')));
    const report = outputs.find((o) => o.name === '보고서.md');
    const res = await fetch(`${api.baseUrl}/api/outputs/${report?.id}/file`, {
      headers: { cookie: owner.header },
    });
    assert.equal(await res.text(), '# 보고서\n결과물 시험\n');
  });

  test('금방 끝난 실행의 구독 사용률도 서버에 닿고, 닿은 에이전트의 일은 쉬었다가 다시 돈다', async () => {
    await newTask(await newAgent(), '').then((created) => taskIn(created.id, 'done'));
    const usage = ok(await api.get('/api/usage', owner)) as { agents: Json[]; plan: Json[] };
    const percent = (window: string) =>
      usage.plan.find((p) => p.tool === 'claude' && p.window === window)?.percent;
    assert.equal(percent('five_hour'), 72);
    assert.equal(percent('seven_day'), 19);

    const held = await newAgent({ planStopPercent: 50 });
    const waiting = await newTask(held, '');
    // 뒤에 넣은 일이 끝나도 앞의 일은 대기열에 남는다
    const other = await newTask(await newAgent(), '');
    await taskIn(other.id, 'done');
    assert.equal((await getTask(waiting.id)).status, 'queued');
    assert.equal((await getTask(waiting.id)).attempts, 0);
    const after = ok(await api.get('/api/usage', owner)) as { agents: Json[] };
    assert.equal(after.agents.find((a) => a.id === held.id)?.holding, true);

    ok(
      await api.request('PATCH', `/api/agents/${held.id}`, owner, {
        version: held.version,
        planStopPercent: 90,
      }),
    );
    await taskIn(waiting.id, 'done');
  });

  test('지시와 역할이 AI CLI에게 가고, 사용자의 것은 아무것도 가지 않는다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, spy.mark);
    const seen = await spy.seen();
    await taskIn(created.id, 'done');
    await runner.logged(`${created.id}: 끝났어요`);

    const env = seen.env as Record<string, string>;
    assert.ok(String(seen.prompt).includes('블로그 글을 쓴다'));
    assert.ok(String(seen.prompt).includes('글을 써 주세요'));
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, OAUTH_TOKEN);
    assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
    assert.equal(Object.values(env).includes(deviceToken), false);
    assert.equal(env.MOIDA_RUNNER_TOKEN, undefined);
    assert.equal(env.DATABASE_URL, undefined);
    assert.notEqual(env.HOME, process.env.HOME);
    // 빈 작업 폴더에 결과물 폴더와 인수인계 메모 자리(.moida)만, 설정 폴더에는 권한 설정 · 메모 훅 (2026-11-17)과
    // 일반 작업의 스킬 moida-work (2026-11-23)만
    assert.deepEqual([...(seen.cwdEntries as string[])].sort(), ['.moida', 'outputs']);
    assert.deepEqual([...(seen.configEntries as string[])].sort(), [
      'hooks',
      'settings.json',
      'skills',
    ]);
    assert.equal(seen.mcpConfigMode, 0o600);
    assert.equal(seen.mcpUrl, `${proxyUrl}/mcp`);
    assert.notEqual(seen.runToken, deviceToken);

    const args = seen.argv as string[];
    for (const flag of ['-p', '--verbose', '--strict-mcp-config']) assert.ok(args.includes(flag));
    assert.equal(args.includes('--bare'), false);
    assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
    assert.equal(
      args[args.indexOf('--tools') + 1],
      'Read,Write,Edit,WebSearch,Skill',
      '스킬(moida-work)을 깔았으면 Skill 도구',
    );

    // 세션 키의 고정 자리: 작업 폴더 · 홈 · 작업 토큰은 지우고, 설정 폴더에는 CLI의 세션 파일(projects)만 남는다.
    // 비우기(LineagePlace.clear)는 작업 폴더 · 홈 · 작업 토큰 다음에 설정 폴더를 비우므로 끝까지 기다린다
    await until('자리가 지워짐', () =>
      [seen.cwd, env.HOME, seen.mcpConfigPath].some((p) => existsSync(String(p))) ||
      readdirSync(String(env.CLAUDE_CONFIG_DIR)).length > 1
        ? null
        : true,
    );
    assert.deepEqual(readdirSync(String(env.CLAUDE_CONFIG_DIR)), ['projects']);
  });

  test('로그와 기록에 토큰이 남지 않는다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, spy.mark);
    const seen = await spy.seen();
    const task = await taskIn(created.id, 'done');
    await runner.logged(`${created.id}: 끝났어요`);

    const record = `${JSON.stringify(task)}\n${runner.logs}`;
    for (const token of [OAUTH_TOKEN, deviceToken, String(seen.runToken)])
      assert.equal(record.includes(token), false);
    assert.ok(JSON.stringify(task).includes('[지움: 토큰]'));
  });

  test('정리 작업은 moida-tidy를 설정 폴더에 넣고 그 권한의 에이전트가 맡는다', async () => {
    const agent = await newAgent({ scopes: ['read_all', 'tidy'] });
    const spy = new Spy();
    const created = await newTask(agent, spy.mark, { kind: 'tidy_session', title: '정리' });
    const seen = await spy.seen();
    await taskIn(created.id, 'done');
    assert.ok(String(seen.prompt).includes('moida-tidy 스킬을 따릅니다'));
    assert.ok((seen.configEntries as string[]).includes('skills'));
  });

  test('스킬이 있으면 설정 폴더에 넣고 따르라고 알린다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, spy.mark, { kind: 'draft_post', title: '초안' });
    const seen = await spy.seen();
    await taskIn(created.id, 'done');
    assert.ok(String(seen.prompt).includes('moida-write 스킬을 따릅니다'));
    assert.ok((seen.configEntries as string[]).includes('skills'));
    const args = seen.argv as string[];
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Write,Edit,WebSearch,Skill');
  });

  test('0이 아닌 코드로 끝나면 failed와 짧은 이유', async () => {
    const agent = await newAgent();
    const created = await newTask(agent, '[fake:fail]');
    const task = await taskIn(created.id, 'failed');
    const error = String((task.result as Json).error);
    assert.ok(error.includes('코드 3'), error);
    assert.ok(error.includes('모델에 닿지 못했어요'), error);
  });

  test('코드가 0이어도 결과가 실패면 failed', async () => {
    const agent = await newAgent();
    const created = await newTask(agent, '[fake:error-result]');
    const task = await taskIn(created.id, 'failed');
    assert.ok(String((task.result as Json).error).includes('턴 수를 넘겼어요'));
  });

  test('허락하지 않은 MCP 서버가 보이면 끄고 failed', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:stray]`);
    const seen = await spy.seen();
    const task = await taskIn(created.id, 'failed');
    assert.ok(String((task.result as Json).error).includes('claude.ai Gmail'));
    await gone(seen.pid);
  });

  test('응답을 잃으면 같은 request_id로 다시 보내 토큰과 결과가 한 번만 남는다', async () => {
    const agent = await newAgent();
    proxy.loseNext(['report_progress', 'submit_result']);
    const created = await newTask(agent, '');
    await taskIn(created.id, 'done');

    // 러너는 일 하나가 끝나야 다음을 받는다. 다음 일이 끝나면 앞의 제출을 다시 보내고 답까지 받은 것이다
    const next = await newTask(agent, '');
    await taskIn(next.id, 'done');

    assert.deepEqual([...proxy.lost].sort(), ['report_progress', 'submit_result']);
    const task = await getTask(created.id);
    assert.equal(tokens(task), FAKE_TOKENS);
    assert.deepEqual(kinds(task), ['read', 'write', 'error', 'result', 'result']);
  });

  test('주인이 취소하면 AI CLI를 끄고 제출하지 않으며 다음 일을 받는다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:hang]`);
    const seen = await spy.seen();
    await taskIn(created.id, 'running');
    assert.equal(alive(seen.pid), true);

    await cancelTask(created);

    await gone(seen.pid);
    await runner.logged(`${created.id}: 주인이 취소했어요`);
    const task = await getTask(created.id);
    assert.equal(task.status, 'cancelled');
    assert.equal(task.result, null);
    await until('자리가 지워짐', () => (existsSync(String(seen.cwd)) ? null : true));

    const next = await newTask(agent, '');
    await taskIn(next.id, 'done');
  });

  test('SIGTERM을 듣지 않는 AI CLI는 SIGKILL로 끈다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:stubborn]`);
    const seen = await spy.seen();
    await until('진행 기록', async () =>
      kinds(await getTask(created.id)).length > 0 ? true : null,
    );
    await cancelTask(created);
    await gone(seen.pid);
    await runner.logged(`${created.id}: 주인이 취소했어요`);
  });

  test('결재를 올리면 AI CLI를 끄고 waiting으로 남긴다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:approval] [fake:hang]`);
    const seen = await spy.seen();

    await taskIn(created.id, 'waiting');
    await gone(seen.pid);
    await runner.logged(`${created.id}: 결재나 하위 작업을 기다려요`);
    const task = await getTask(created.id);
    assert.equal(task.status, 'waiting');
    assert.equal(task.result, null);
    const { approvals } = ok(await api.get('/api/approvals', owner)) as { approvals: Json[] };
    assert.equal(approvals.filter((a) => a.taskId === created.id).length, 1);
  });

  test('결재를 올리고 바로 끝난 실행도 done으로 보내지 않는다', async () => {
    const agent = await newAgent();
    const created = await newTask(agent, '[fake:approval]');
    await runner.logged(`${created.id}: 결재나 하위 작업을 기다려요`);
    const task = await getTask(created.id);
    assert.equal(task.status, 'waiting');
    assert.equal(kinds(task).filter((k) => k === 'result').length, 1);
    assert.equal(task.result, null);
  });

  test('끝나면 원문과 AI가 쓴 인수인계 메모를 작업 세션에 쌓는다 (2026-11-17)', async () => {
    const agent = await newAgent();
    const created = await newTask(agent, '[fake:memo=한 일: 초안 저장. 남은 일: 사진 고르기]');
    await taskIn(created.id, 'done');
    const db = api.service(Database);
    const [memo] = await db.sql`
      SELECT memo, written_by, lineage, run_seq FROM vault.run_memos WHERE task_id = ${String(created.id)}`;
    assert.deepEqual(
      [memo?.memo, memo?.written_by, memo?.lineage, memo?.run_seq],
      ['한 일: 초안 저장. 남은 일: 사진 고르기', 'ai', `task:${created.id}`, 1],
    );
    const [run] = await db.sql`
      SELECT cli_session, resumed FROM task.task_runs WHERE task_id = ${String(created.id)}`;
    assert.ok(run?.cli_session, 'CLI 세션 id를 첫 보고로 남긴다');
    assert.equal(run?.resumed, false);
    const [session] = await db.sql`
      SELECT s.transcript_count, t.text FROM vault.sessions s
      JOIN vault.session_transcripts t ON t.session_id = s.node_id
      WHERE s.tool = 'moida-agent' AND s.source_session_id = ${`task:${created.id}`}`;
    assert.equal(session?.transcript_count, 1);
    assert.match(String(session?.text), /- 도구: Read notes\.md/);
    assert.equal(String(session?.text).includes(OAUTH_TOKEN), false, '토큰은 원문에 남지 않는다');
  });

  test('메모가 없으면 러너가 대신 남기고, 승인을 기다리다 돌아온 실행은 앞 CLI 세션을 재개한다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:approval]`);
    const first = await spy.seen();
    await taskIn(created.id, 'waiting');
    const db = api.service(Database);
    const id = String(created.id);
    const written = await until('러너가 대신 쓴 메모', async () => {
      const [row] = await db.sql`SELECT written_by FROM vault.run_memos WHERE task_id = ${id}`;
      return row ? String(row.written_by) : null;
    });
    assert.equal(written, 'runner');
    assert.equal((first.argv as string[]).includes('--no-session-persistence'), false);
    const firstSession = await until('첫 실행의 CLI 세션', async () => {
      const [row] = await db.sql`SELECT cli_session FROM task.task_runs WHERE task_id = ${id}`;
      return row?.cli_session ? String(row.cli_session) : null;
    });
    const { approvals } = ok(await api.get('/api/approvals', owner)) as { approvals: Json[] };
    const approval = approvals.find((a) => a.taskId === created.id) as Json;
    ok(
      await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
        version: approval.version,
        decision: 'revise',
        note: '제목을 바꿔 주세요',
      }),
    );
    const second = await until('다시 뜬 실행', async () => {
      const seen = JSON.parse(readFileSync(spy.path, 'utf8')) as Json;
      return seen.pid === first.pid ? null : seen;
    });
    const argv = second.argv as string[];
    assert.equal(
      argv[argv.indexOf('--resume') + 1],
      firstSession,
      '같은 세션 키 · 같은 러너라 재개한다',
    );
    assert.match(String(second.prompt), /^# 이어서 하는 실행/);
    await until('두 번째 실행의 기록', async () => {
      const rows =
        await db.sql`SELECT resumed FROM task.task_runs WHERE task_id = ${id} ORDER BY seq`;
      return rows.length === 2 && rows[1]?.resumed === true ? rows : null;
    });
  });

  test('대표가 일꾼에게 맡기면 일꾼의 일이 돌고, 모두 끝나면 결과를 받아 대표가 끝낸다 (맡기기는 대표만, 2026-11-21)', async () => {
    const lead = await leadOf();
    const members = [await newAgent({ name: '조사 1' }), await newAgent({ name: '조사 2' })];
    const restore = await onlyWorkers(members);
    try {
      const spy = new Spy();
      const created = await newTask(lead, `[fake:delegate] ${spy.mark}`);

      await runner.logged(`${created.id}: 결재나 하위 작업을 기다려요`);
      // 대표를 깨우는 일은 일꾼(outbox)이 한다. 이 테스트에는 일꾼 프로세스가 없어 직접 돌린다
      const worker = api.service(OutboxWorker);
      const done = await until('대표가 깨어나 끝남', async () => {
        await worker.tick();
        const task = await getTask(created.id);
        return task.status === 'done' ? task : null;
      });
      const children = done.children as Json[];
      assert.deepEqual(
        children.map((c) => [c.agentId, c.status]).sort(),
        members.map((m) => [m.id, 'done']).sort(),
      );
      // 마지막 실행(깨어난 대표)의 지시문에 일꾼의 결과가 있다
      const { prompt } = await spy.seen();
      assert.ok(String(prompt).includes('# 맡긴 하위 작업의 결과'));
      assert.ok(String(prompt).includes('## [완료] 조사 1에게 맡긴 조사 (조사 1)'));
      assert.ok(String(prompt).includes('남은 위임 · 기다리기 횟수: 2'));
    } finally {
      await restore();
    }
  });

  test('대화는 대표가 맡고(O-2), 대표의 지시문에는 lead 단락과 맨 위 팀장 목록이 들어간다', async () => {
    const head = await newAgent({ name: '대표 아래 팀장' });
    const spy = new Spy();
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        // 표시는 둘째 줄에: 첫 줄은 회차 작업의 제목(60자로 자름)이 되어 가짜 CLI가 잘린 표시를 읽는다
        message: `이번 주 글감을 정리해 줘\n${spy.mark}`,
      }),
      201,
    );
    const { lead } = ok(await api.get('/api/agents/lead', owner)) as { lead: Json };
    assert.equal(chat.agentId, lead.id);
    const { prompt } = await spy.seen();
    assert.ok(String(prompt).includes('# 대표로 일하는 법'));
    assert.ok(String(prompt).includes('continue: true'));
    assert.ok(String(prompt).includes(`대표 아래 팀장 (agent_id: ${head.id})`));
    await until('대표의 회차가 끝남', async () => {
      const room = ok(await api.get(`/api/chats/${chat.id}`, owner)) as { turns: Json[] };
      return room.turns[0]?.status === 'done' ? room : null;
    });
  });

  test('대화에 넣은 사진은 작업 폴더의 photos/에 받아 두고, 지시문에 그 경로를 적는다 (대화에 사진 넣기)', async () => {
    const photo = await uploadPhoto('영수증.png');
    const spy = new Spy();
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: `이 사진 봐 줘\n${spy.mark}`,
        refs: [{ kind: 'output', id: photo.id }],
      }),
      201,
    );
    const seen = await spy.seen();
    assert.deepEqual(seen.photos, [{ name: 'photo-1.png', sha256: sha256(photo.bytes) }]);
    const path = join(String(seen.cwd), 'photos', 'photo-1.png');
    // 결과물은 늘 비공개 참조다
    assert.ok(
      String(seen.prompt).includes(`영수증.png (비공개): 사진 · ${path}에 받아 두었습니다`),
    );
    assert.equal((seen.argv as string[]).includes('--image'), false, 'Claude는 파일을 읽는다');
    const room = await until('사진을 본 회차가 끝남', async () => {
      const room = ok(await api.get(`/api/chats/${chat.id}`, owner)) as { turns: Json[] };
      return room.turns[0]?.status === 'done' ? room : null;
    });
    const task = await getTask(room.turns[0]?.taskId);
    const notes = events(task).map((e) => e.body);
    assert.ok(notes.includes('사진 1장을 받았어요'), JSON.stringify(notes));
    const [made] = await db.sql`
      SELECT count(*)::int AS n FROM task.outputs WHERE task_id = ${String(task.id)}`;
    assert.equal(made?.n, 0, '받은 사진은 결과물로 다시 올라가지 않는다 (outputs/와 따로)');
  });

  /** 일꾼(outbox)의 일을 다 한다: 결과 카드 · 다시 맡기기 · 설정 적용 (e2e는 일꾼을 따로 돌리지 않는다) */
  const settle = async (): Promise<void> => {
    while ((await api.service(OutboxWorker).tick()) > 0);
  };

  test('대표가 set_deliver로 받을 것을 정하고, 결과에 없으면 서버가 같은 대화에 다시 맡긴다 (O-3)', async () => {
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '보고서를 파일로 줘\n[fake:deliver=file]',
      }),
      201,
    );
    const room = await until('다시 맡긴 회차', async () => {
      await settle();
      const now = ok(await api.get(`/api/chats/${chat.id}`, owner)) as { turns: Json[] };
      return now.turns.length >= 2 ? now : null;
    });
    const [first, again] = room.turns as Json[];
    assert.deepEqual([first?.deliver, first?.deliverNote], ['file', '테스트용 CLI가 정함']);
    assert.deepEqual(
      [again?.fix, again?.note, again?.deliver],
      [true, '받을 것(파일)이 없어 다시 맡김', 'file'],
    );
    // 뒤 테스트에 일이 남지 않게 멈춘다
    const now = ok(await api.get(`/api/chats/${chat.id}`, owner)) as { chat: Json };
    const stopped = await api.request('POST', `/api/chats/${chat.id}/stop`, owner, {
      version: now.chat.version,
    });
    assert.ok([200, 204].includes(stopped.status), stopped.text);
  });

  test('앱 관리에서 연 대화의 대표 지시문에 그 앱이 실린다 (스토어 2단계: 그 앱의 운영 팀장에게)', async () => {
    const app = ok(
      await api.request('POST', '/api/apps', owner, {
        requestId: randomUUID(),
        kind: 'blog',
        name: '운영 앱',
        slug: `ops-${randomUUID().slice(0, 6)}`,
      }),
      201,
    );
    const spy = new Spy();
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: `이 앱에 글 하나 써 줘\n${spy.mark}`,
        appId: app.id,
      }),
      201,
    );
    const prompt = String((await spy.seen()).prompt);
    assert.ok(prompt.includes(`이 대화는 앱 하나의 일입니다 (app_id: ${app.id})`), prompt);
    assert.ok(prompt.includes('get_settings kind: apps'));
    await settle();
    const now = ok(await api.get(`/api/chats/${chat.id}`, owner)) as { chat: Json };
    const stopped = await api.request('POST', `/api/chats/${chat.id}/stop`, owner, {
      version: now.chat.version,
    });
    assert.ok([200, 204].includes(stopped.status), stopped.text);
  });

  test('대표가 대화에서 자동화를 제안하고, 승인하면 그 대화에 묶인다 (O-3 대화로 자동화)', async () => {
    const title = `아침 정리 ${randomUUID().slice(0, 6)}`;
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: `매일 아침 소식 정리해 줘\n[fake:automate=${title}]`,
      }),
      201,
    );
    const card = await until('자동화 제안이 결과 카드에', async () => {
      await settle();
      const now = ok(await api.get(`/api/chats/${chat.id}`, owner)) as { card: Json | null };
      return (now.card?.items as Json[] | undefined)?.length ? now.card : null;
    });
    assert.deepEqual([card.deliver, card.passed], ['setting', true]);
    const decided = await api.request('POST', `/api/approvals/${card.id}/decide`, owner, {
      version: card.version,
      decision: 'approve',
    });
    assert.ok([200, 204].includes(decided.status), decided.text);
    const room = await until('대화에 묶인 자동화', async () => {
      await settle();
      const now = ok(await api.get(`/api/chats/${chat.id}`, owner)) as { automations: Json[] };
      return now.automations.length > 0 ? now : null;
    });
    assert.deepEqual(
      room.automations.map((a: Json) => [a.title, a.mode, a.atTime, a.enabled]),
      [[title, 'daily', '08:00', true]],
    );
    const { schedules } = ok(await api.get('/api/schedules', owner)) as { schedules: Json[] };
    // 뒤 테스트에 돌지 않게 지운다
    const made = schedules.find((s) => s.title === title) as Json;
    const removed = await api.request('POST', `/api/schedules/${made.id}/delete`, owner, {
      version: made.version,
    });
    assert.equal(removed.status, 204, removed.text);
  });

  test('에이전트가 멈추면 AI CLI를 끄고 일을 돌려준다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:hang]`);
    const seen = await spy.seen();
    await taskIn(created.id, 'running');

    ok(
      await api.request('POST', `/api/agents/${agent.id}/pause`, owner, {
        version: agent.version,
      }),
    );

    const task = await taskIn(created.id, 'queued');
    await gone(seen.pid);
    const bodies = events(task).map((e) => e.body);
    assert.ok(bodies.includes('돌려줌: 에이전트가 멈췄어요'), JSON.stringify(bodies));
  });
});

// 서버 러너의 길: 환경 변수에 토큰이 없고, 콘솔에 넣은 토큰을 일마다 ai_login으로 받는다.
describe('콘솔에 넣은 토큰으로 일한다', () => {
  let runner: RunnerProcess;

  const claude = async (): Promise<Json> =>
    (ok(await api.get('/api/ai', owner)) as { tools: Json[] }).tools[0] as Json;
  const saveToken = async (token: string): Promise<void> => {
    ok(await api.request('PUT', '/api/ai/claude/token', owner, { token }));
  };
  const startTest = async (): Promise<Json> =>
    ok(await api.request('POST', '/api/ai/claude/test', owner));

  before(async () => {
    runner = RunnerProcess.start(api.baseUrl, { CLAUDE_CODE_OAUTH_TOKEN: '' });
    await runner.logged('AI 로그인은 콘솔의 AI 메뉴에서 해요');
  });

  after(async () => {
    assert.equal(await runner.stop(), 0);
  });

  test('토큰이 없으면 서버가 일을 주지 않고 기다렸다가, 넣으면 그 토큰으로 일한다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, spy.mark);

    await runner.logged('일할 수 있는 AI: claude');
    await new Promise((done) => setTimeout(done, 4_000)); // 서버가 몇 번 더 살펴볼 시간
    const held = await getTask(created.id);
    assert.equal(held.status, 'queued', '실패로 끝내지 않는다');
    assert.equal(held.attempts, 0);
    assert.deepEqual(events(held), [], '오류 기록이 쌓이지 않는다');
    assert.match(runner.logs, /AI 로그인은 콘솔의 AI 메뉴에서/);

    const token = `sk-ant-oat01-${randomUUID()}`;
    await saveToken(token);

    const seen = await spy.seen();
    assert.equal((seen.env as Json).CLAUDE_CODE_OAUTH_TOKEN, token);
    const task = await taskIn(created.id, 'done');
    await runner.logged(`${created.id}: 끝났어요`);
    assert.equal(
      events(task).some((e) => String(e.body).startsWith('돌려줌')),
      false,
    );
    const record = `${JSON.stringify(task)}\n${runner.logs}`;
    assert.equal(record.includes(token), false);
    assert.ok(JSON.stringify(task).includes('[지움: 토큰]'), '가짜 CLI가 뱉은 토큰을 지웠다');
  });

  test('연결 확인은 일을 받을 에이전트가 없어도 MCP 없이 돌고 결과를 남긴다', async () => {
    await db.sql`UPDATE task.agents SET status = 'paused'`;
    await saveToken(`sk-ant-oat01-${randomUUID()}`);
    assert.equal((await claude()).checkedAt, null);

    const { taskId } = await startTest();
    const task = await taskIn(taskId, 'done');

    assert.deepEqual(task.result, { text: 'ok' }, 'MCP 설정이 있었다면 가짜 CLI가 다르게 답한다');
    assert.equal(task.agentId, null);
    const state = await claude();
    assert.ok(state.checkedAt);
    assert.equal(state.lastError, null);
  });

  test('틀린 토큰이면 이유를 남기고, 토큰은 어디에도 남지 않는다', async () => {
    const token = `sk-ant-oat01-wrong-${randomUUID()}`;
    await saveToken(token);

    const { taskId } = await startTest();
    const task = await taskIn(taskId, 'failed');

    const state = await claude();
    assert.ok(state.checkedAt);
    assert.match(String(state.lastError), /코드 1.*틀린 토큰/);
    const record = `${JSON.stringify(task)}\n${JSON.stringify(state)}\n${runner.logs}`;
    assert.equal(record.includes(token), false);
    assert.equal(record.includes('[지움: 토큰]'), true);
  });
});

// 콘솔에 토큰을 지우는 길이 없어 만료시킨다. 러너가 꺼진 사이 맡긴 확인이 대기열에 남는 경우다.
describe('기다리는 연결 확인의 토큰이 사라진다', () => {
  test('토큰이 없는 동안 대기열에 남고, 돌아오면 다른 일보다 먼저 돈다', async () => {
    const token = `sk-ant-oat01-${randomUUID()}`;
    ok(await api.request('PUT', '/api/ai/claude/token', owner, { token }));
    const test = ok(await api.request('POST', '/api/ai/claude/test', owner));
    await db.sql`UPDATE task.ai_logins SET expires_at = now() - interval '1 second'`;
    const other = await newTask(await newAgent(), '');

    const runner = RunnerProcess.start(api.baseUrl, { CLAUDE_CODE_OAUTH_TOKEN: '' });
    await runner.logged('일할 수 있는 AI: claude');
    await new Promise((done) => setTimeout(done, 1_500));
    const held = await getTask(test.taskId);
    assert.equal(held.status, 'queued');
    assert.deepEqual(events(held), []);
    assert.equal((await getTask(other.id)).status, 'queued');

    ok(await api.request('PUT', '/api/ai/claude/token', owner, { token }));

    await taskIn(test.taskId, 'done');
    await taskIn(other.id, 'done');
    await runner.logged(`${other.id}: 끝났어요`);
    const logs = runner.logs;
    assert.ok(
      logs.indexOf(`${test.taskId}: 일을 맡았어요`) < logs.indexOf(`${other.id}: 일을 맡았어요`),
    );
    runner.signal('SIGTERM');
    await newTask(await newAgent(), ''); // 긴 폴링을 깨워 바로 끝나게 한다
    assert.equal(await runner.exited(), 0);
  });
});

// 배포 서버 안의 러너: 토큰 없이 서버와 함께 보는 볼륨의 연결 값으로 스스로 연결한다.
describe('서버 러너는 연결 값으로 스스로 연결한다', () => {
  test('토큰 없이 연결해 일하고, 주인이 끊으면 다시 연결해 이어 간다', async () => {
    const file = join(spyDir, 'pairing');
    writeFileSync(file, api.service(ServerRunnerPolicy).secret());
    const runner = RunnerProcess.start(api.baseUrl, {
      MOIDA_RUNNER_TOKEN: '',
      MOIDA_RUNNER_PAIRING_FILE: file,
    });
    try {
      await runner.logged('서버 러너로 연결했어요');

      const agent = await newAgent();
      const first = await newTask(agent, '');
      await taskIn(first.id, 'done');

      const { devices } = ok(await api.get('/api/devices', owner)) as {
        devices: { id: string; name: string }[];
      };
      const device = devices.find((d) => d.name === '서버 러너');
      ok(await api.request('POST', `/api/devices/${device?.id}/revoke`, owner));
      // 러너는 기다리던 next_jobs(25초)가 끝난 뒤의 다음 요청에서 거절을 알고 다시 연결한다
      await runner.logged('서버가 토큰을 거절해 다시 연결해요', 40_000);
      await until('다시 연결', () =>
        runner.logs.split('서버 러너로 연결했어요').length - 1 === 2 ? true : null,
      );

      const second = await newTask(agent, '');
      await taskIn(second.id, 'done');
      assert.equal(runner.logs.includes(api.service(ServerRunnerPolicy).secret()), false);
    } finally {
      assert.equal(await runner.stop('SIGTERM'), 0);
    }
  });
});

// 코드 러너 칸 (docs/코드작업.md 2단계): 칸마다 기기 하나로 스스로 붙고(서버 러너와 다른 연결 값), 코드 작업은 칸에게만 간다.
// 여기서는 저장소 정보(payload.code)가 없는 코드 작업이라 칸이 AI를 띄우지 않고 실패로 끝낸다. 작업 공간은 아래 '코드 작업 (작업 공간)'.
describe('코드 러너 칸', () => {
  test('칸 2개가 각자 기기로 붙고, 코드 작업은 칸 하나가 맡는다', async () => {
    const file = join(spyDir, 'code-pairing');
    const secret = api.service(ServerRunnerPolicy).codeSecret();
    writeFileSync(file, secret);
    const slots = ['1', '2'].map((slot) =>
      RunnerProcess.start(api.baseUrl, {
        MOIDA_RUNNER_TOKEN: '',
        MOIDA_RUNNER_PAIRING_FILE: file,
        MOIDA_RUNNER_SLOT: slot,
        MOIDA_SANDBOX: '1',
        MOIDA_AGENT_USER: 'self',
      }),
    );
    try {
      await slots[0]?.logged('코드 러너 칸 1로 연결했어요');
      await slots[1]?.logged('코드 러너 칸 2로 연결했어요');
      // 능력 줄은 연결 뒤 CLI 버전을 읽고 나서 찍힌다
      await Promise.all(slots.map((s) => s.logged('코드 작업만 받음')));
      const { devices } = ok(await api.get('/api/devices', owner)) as {
        devices: { name: string; scopes: string[]; revokedAt: string | null }[];
      };
      const live = devices.filter((d) => d.revokedAt === null && d.name.startsWith('코드 러너'));
      assert.deepEqual(live.map((d) => d.name).sort(), ['코드 러너 1', '코드 러너 2']);
      for (const device of live) assert.deepEqual(device.scopes, ['run', 'sandbox']);

      const coder = await newAgent({
        name: '코드 담당',
        scopes: ['read_public', 'code'],
        approvalActions: [],
      });
      const created = await newTask(coder, '', { kind: 'code' });
      const task = await taskIn(created.id, 'failed');
      assert.match(String((task.result as Json).error), /코드 작업의 저장소 정보가 틀려요/);
      const takers = slots.filter((s) => s.logs.includes(`${created.id}: 일을 맡았어요`));
      assert.equal(takers.length, 1, '칸 하나가 맡는다');
      assert.equal(
        slots.some((s) => s.logs.includes(secret)),
        false,
        '연결 값은 로그에 없다',
      );
    } finally {
      const codes = await Promise.all(slots.map((s) => s.stop('SIGTERM')));
      assert.deepEqual(codes, [0, 0]);
    }
  });
});

// 코드 작업 (docs/코드작업.md 3단계): 칸이 저장소를 받아 AI에게 셸과 함께 맡기고, 맡긴 경로 안의 변경만 moida/<작업>에 올린다.
// GitHub 대신 이 컴퓨터의 시험용 git 서버(http-backend)에 붙는다. AI 사용자는 self(시험용): 사용자 나누기는 Docker 시험에서 본다.
describe('코드 작업 (작업 공간)', () => {
  let git: GitServer;
  let repoUrl: string;
  let work: string;
  let slot: RunnerProcess;
  let coder: Json;
  const code = (more: Json = {}) => ({
    repo: { url: repoUrl, base: 'main' },
    paths: ['src'],
    setup: 'test -f README.md',
    checks: ['test -f src/a.ts'],
    ...more,
  });
  const codeTask = (marks: string, more: Json = {}) =>
    newTask(coder, marks, { kind: 'code', payload: { code: code(more) } });
  const resultOf = (task: Json) => task.result as Json;
  const roomsLeft = () =>
    until('작업 자리를 지움', () => (readdirSync(work).length === 0 ? true : null));

  before(async () => {
    git = await GitServer.start();
    repoUrl = git.create('app', { 'src/a.ts': 'export const a = 1;\n', 'README.md': '# app\n' });
    work = mkdtempSync(join(tmpdir(), 'moida-work-'));
    const file = join(spyDir, 'code-pairing-3');
    writeFileSync(file, api.service(ServerRunnerPolicy).codeSecret());
    slot = RunnerProcess.start(api.baseUrl, {
      MOIDA_RUNNER_TOKEN: '',
      MOIDA_RUNNER_PAIRING_FILE: file,
      MOIDA_RUNNER_SLOT: '3',
      MOIDA_SANDBOX: '1',
      MOIDA_AGENT_USER: 'self',
      MOIDA_WORK_DIR: work,
    });
    await slot.logged('코드 러너 칸 3로 연결했어요');
    coder = await newAgent({
      name: '코드 담당',
      scopes: ['read_public', 'code'],
      approvalActions: [],
    });
  });

  after(async () => {
    assert.equal(await slot.stop('SIGTERM'), 0);
    git.close();
    rmSync(work, { recursive: true, force: true });
  });

  test('저장소를 받아 셸과 함께 고치고, 맡긴 경로 안의 변경만 커밋 하나로 moida/<작업>에 올린다', async () => {
    const spy = new Spy();
    const created = await codeTask(
      `[fake:edit=src/a.ts] [fake:edit=src/new/b.ts] [fake:outputs] ${spy.mark}`,
    );
    const task = await taskIn(created.id, 'done');
    const branch = `moida/${created.id}`;
    const text = String(resultOf(task).text);
    assert.match(text, new RegExp(`${branch} 브랜치에 올렸어요`));
    assert.match(text, /- test -f src\/a.ts: 통과/);
    assert.deepEqual([...git.changed('app', branch)].sort(), ['src/a.ts', 'src/new/b.ts']);
    assert.equal(git.show('app', branch, 'src/new/b.ts'), '고친 내용 src/new/b.ts\n');
    assert.ok(git.head('app', 'main'), '기준 브랜치는 그대로');
    // 결과물은 저장소 밖의 자리 폴더에서 agent 권한으로 옮겨 올린다: 커밋에는 들어가지 않는다
    assert.deepEqual((task.outputs as Json[]).map((o) => o.name).sort(), [
      'chart.png',
      '보고서.md',
    ]);

    const seen = await spy.seen();
    const argv = seen.argv as string[];
    assert.match(argv[argv.indexOf('--tools') + 1] ?? '', /Bash/, '코드 작업에만 셸을 연다');
    assert.match(
      argv[argv.indexOf('--add-dir') + 1] ?? '',
      /\/outputs$/,
      '결과물 폴더를 열어 준다',
    );
    assert.match(String(seen.cwd), /\/work$/, 'AI는 저장소 사본에서 돈다');
    assert.match(String(seen.prompt), /# 고칠 수 있는 곳\n- src/);
    assert.match(String(seen.prompt), /moida-code 스킬을 따릅니다/);
    const env = seen.env as Record<string, string>;
    assert.equal(env.MOIDA_RUNNER_PAIRING_FILE, undefined, '러너의 설정은 AI에게 가지 않는다');
    const bodies = events(task).map((e) => String(e.body));
    assert.ok(bodies.includes('setup 통과'), bodies.join(' | '));
    assert.ok(bodies.some((b) => b.startsWith(`${branch}에 올렸어요`)));
    await roomsLeft();
  });

  test('맡긴 경로 밖을 고치면 올리지 않고 실패로 끝낸다 (어느 파일인지 적는다)', async () => {
    const created = await codeTask('[fake:edit=src/ok.ts] [fake:edit=README.md]');
    const task = await taskIn(created.id, 'failed');
    assert.match(String(resultOf(task).error), /맡긴 경로 밖을 고쳐서 올리지 않았어요: README.md/);
    assert.equal(git.head('app', `moida/${created.id}`), null);
    await roomsLeft();
  });

  test('.github/workflows는 저장소 전체를 맡겨도 막는다', async () => {
    const created = await codeTask('[fake:edit=.github/workflows/ci.yml]', { paths: ['.'] });
    const task = await taskIn(created.id, 'failed');
    assert.match(String(resultOf(task).error), /\.github\/workflows\/ci.yml/);
    assert.equal(git.head('app', `moida/${created.id}`), null);
  });

  test('setup이 실패하면 AI를 띄우지 않는다', async () => {
    const spy = new Spy();
    const created = await codeTask(spy.mark, { setup: 'echo 설치 실패 >&2; exit 7' });
    const task = await taskIn(created.id, 'failed');
    assert.match(
      String(resultOf(task).error),
      /setup이 코드 7로 끝나 AI를 띄우지 않았어요\n설치 실패/,
    );
    assert.equal(existsSync(spy.path), false);
    await roomsLeft();
  });

  test('검사가 실패해도 올리고, 실패한 명령과 끝부분을 결과에 적는다', async () => {
    const created = await codeTask('[fake:edit=src/c.ts]', {
      checks: ['test -f src/c.ts', 'echo 테스트 망함 >&2; exit 1'],
    });
    const task = await taskIn(created.id, 'done');
    const text = String(resultOf(task).text);
    assert.match(text, /- test -f src\/c.ts: 통과/);
    assert.match(text, /- echo 테스트 망함 >&2; exit 1: 코드 1/);
    assert.match(text, /테스트 망함/);
    assert.ok(git.head('app', `moida/${created.id}`));
  });

  // 검증 고리 V: 검사에 떨어지면 같은 작업 폴더에서 AI를 한 번 더 띄워 떨어진 출력을 보이고, 다시 검사한 뒤 끝낸다
  test('검사에 떨어지면 같은 자리에서 AI에게 한 번 더 맡기고, 고친 뒤 통과한 검사를 결과에 싣는다', async () => {
    const spy = new Spy();
    const runs = new Runs();
    // 제목은 따로: 지시의 첫 줄에서 자른 제목에 반쪽 표시가 남지 않게
    const created = await newTask(
      coder,
      `[fake:edit=src/d.ts] [fake:fix=src/fixed.ts] ${runs.mark} ${spy.mark}`,
      {
        kind: 'code',
        title: '검사 고치기',
        payload: { code: code({ checks: ['test -f src/d.ts', 'test -f src/fixed.ts'] }) },
      },
    );
    const task = await taskIn(created.id, 'done');
    assert.equal(runs.count(), 2, 'AI가 두 번 떴다');
    const result = resultOf(task);
    assert.deepEqual(result.checks, [
      { name: 'test -f src/d.ts', ok: true, how: '통과', retried: true },
      { name: 'test -f src/fixed.ts', ok: true, how: '통과', retried: true },
    ]);
    assert.match(
      String(result.text),
      /검사 \(떨어져 AI가 한 번 더 고친 뒤\):\n- test -f src\/d.ts: 통과\n- test -f src\/fixed.ts: 통과/,
    );
    const branch = `moida/${created.id}`;
    assert.deepEqual([...git.changed('app', branch)].sort(), ['src/d.ts', 'src/fixed.ts']);
    // 두 번째 실행의 지시문: 처음 지시와 앞 답, 떨어진 검사만
    const prompt = String((await spy.seen()).prompt);
    assert.match(prompt, /# 할 일: 검사 고치기\n# 검사에 떨어졌어요: 검사 고치기/);
    assert.match(prompt, /## 앞 실행의 마지막 답\n초안을 저장했어요/);
    assert.match(prompt, /- test -f src\/fixed.ts: 코드 1\n```\n\(출력 없음\)\n```/);
    assert.doesNotMatch(prompt, /- test -f src\/d.ts: /, '통과한 검사는 싣지 않는다');
    assert.match(prompt, /# 고칠 수 있는 곳\n- src/, '단계의 단락은 그대로');
    const bodies = events(task).map((e) => String(e.body));
    assert.ok(bodies.includes('검사 test -f src/fixed.ts: 코드 1'), bodies.join(' | '));
    assert.equal(bodies.filter((b) => b === '검사에 떨어져 AI에게 한 번 더 맡겨요').length, 1);
    await roomsLeft();
  });

  test('다시 맡겨도 떨어지면 세 번째로 띄우지 않고 지금처럼 끝낸다', async () => {
    const runs = new Runs();
    const created = await codeTask(`[fake:edit=src/e.ts] ${runs.mark}`, {
      checks: ['test -f src/e.ts', 'echo 여전히 망함 >&2; exit 1'],
    });
    const task = await taskIn(created.id, 'done');
    const result = resultOf(task);
    assert.deepEqual(result.checks, [
      { name: 'test -f src/e.ts', ok: true, how: '통과', retried: true },
      { name: 'echo 여전히 망함 >&2; exit 1', ok: false, how: '코드 1', retried: true },
    ]);
    assert.match(String(result.text), /--- echo 여전히 망함 >&2; exit 1의 끝부분 ---\n여전히 망함/);
    assert.ok(git.head('app', `moida/${created.id}`), '떨어져도 지금처럼 올린다');
    assert.equal(runs.count(), 2, 'AI는 두 번까지만');
    await roomsLeft();
  });

  test('다시 맡긴 실행도 첫 실행처럼 지켜본다: 주인이 취소하면 끄고 제출하지 않는다', async () => {
    const runs = new Runs();
    const created = await codeTask(`[fake:edit=src/f.ts] [fake:fix-hang] ${runs.mark}`, {
      checks: ['test -f src/never.ts'],
    });
    const [, second] = await until('AI가 두 번째로 뜸', () => {
      const pids = runs.pids();
      return pids.length === 2 ? pids : null;
    });
    assert.equal(alive(second), true);

    await cancelTask(created);

    await gone(second);
    await slot.logged(`${created.id}: 주인이 취소했어요`);
    const task = await getTask(created.id);
    assert.equal(task.status, 'cancelled');
    assert.equal(task.result, null);
    assert.equal(git.head('app', `moida/${created.id}`), null, '올리지 않는다');
    await roomsLeft();
  });

  test('바꾼 파일이 없으면 올리지 않고 끝낸다. 없는 저장소는 실패', async () => {
    const quiet = await codeTask('');
    const done = await taskIn(quiet.id, 'done');
    assert.match(String(resultOf(done).text), /바꾼 파일이 없어 올리지 않았어요/);
    assert.equal(git.head('app', `moida/${quiet.id}`), null);

    const missing = await codeTask('', { repo: { url: `${git.baseUrl}/없음.git`, base: 'main' } });
    const failed = await taskIn(missing.id, 'failed');
    assert.match(String(resultOf(failed).error), /저장소를 받지 못했어요/);
    await roomsLeft();
  });

  // 결과물 2차: 만들기 작업도 같은 칸에서 셸과 함께 돈다. 재료 결과물은 러너가 표로 받아 inputs/에 두고,
  // 재료 위키는 AI가 작업 토큰의 허락으로 get_wiki로 읽는다. 만든 파일이 없으면 실패다
  describe('만들기 작업', () => {
    let maker: Json;
    const makeTask = (marks: string, materials: Json = {}) =>
      newTask(maker, marks, { kind: 'make', materials });

    before(async () => {
      // 읽기 권한 없이 make만: 재료 위키는 작업 토큰의 허락으로만 읽는다
      maker = await newAgent({ name: '만들기 담당', scopes: ['make'], approvalActions: [] });
    });

    test('재료 파일과 고른 위키로 만든 파일이 결과물로 올라오고, 결재 없이 끝난다', async () => {
      const first = await taskIn((await makeTask('[fake:make]')).id, 'done');
      const [material] = first.outputs as Json[];
      assert.equal(material?.name, '발표.pptx');
      const wiki = ok(
        await api.request('POST', '/api/wikis', owner, {
          requestId: randomUUID(),
          title: `비공개 재료 ${randomUUID()}`,
          bodyMd: '## 요약\n칸 안에서 읽는 비공개 위키',
        }),
        201,
      );
      const spy = new Spy();
      const created = await makeTask(`[fake:make] ${spy.mark}`, {
        outputIds: [material?.id],
        wikiIds: [wiki.id],
      });
      const task = await taskIn(created.id, 'done');
      const outputs = task.outputs as Json[];
      assert.deepEqual(
        outputs.map((o) => o.name),
        ['발표.pptx'],
      );
      const res = await fetch(`${api.baseUrl}/api/outputs/${outputs[0]?.id}/file`, {
        headers: { cookie: owner.header },
      });
      const made = await res.text();
      assert.match(made, /재료 파일: 발표\.pptx/, '재료를 inputs/에서 읽었다');
      assert.match(made, /칸 안에서 읽는 비공개 위키/, '고른 위키를 get_wiki로 읽었다');

      const seen = await spy.seen();
      const argv = seen.argv as string[];
      assert.match(argv[argv.indexOf('--tools') + 1] ?? '', /Bash/, '만들기에도 셸을 연다');
      assert.ok(
        argv.some((a) => /\/inputs$/.test(a)),
        '재료 폴더를 열어 준다',
      );
      const prompt = String(seen.prompt);
      assert.match(prompt, /# 재료/);
      assert.match(prompt, new RegExp(`- wiki_id: ${wiki.id}`));
      assert.match(prompt, /moida-make 스킬을 따릅니다/);
      const bodies = events(task).map((e) => String(e.body));
      assert.ok(bodies.includes('재료 파일 1개를 받았어요'), bodies.join(' | '));
      await roomsLeft();
    });

    // 스토어 1-6c: 앱 코드를 고치는 만들기 일. 러너가 지금 코드(app_code_base)를 inputs/app/에 두고, AI가 낸 파일을
    // 그 위에 얹어 묶음 · 템플릿을 검사한다. 끝나면 서버가 같은 코드 위에 얹은 새 버전을 만든다 (task.app_code.built)
    const newApp = async (slug: string) =>
      ok(
        await api.request('POST', '/api/apps', owner, {
          requestId: randomUUID(),
          kind: 'blog',
          name: `앱 ${slug}`,
          slug,
        }),
        201,
      );
    const appTask = (marks: string, app: Json) =>
      newTask(maker, marks, { kind: 'make', appCode: { appId: app.id } });
    const codeOf = async (app: Json) => {
      while ((await api.service(OutboxWorker).tick()) > 0);
      return ok(await api.get(`/api/apps/${app.id}/code`, owner));
    };

    test('앱 코드: 바꾼 파일만 낸 결과가 시작 코드 위에 얹힌 새 버전이 된다', async () => {
      const app = await newApp(`e2e-app-${randomUUID().slice(0, 6)}`);
      const created = await appTask('[fake:app]', app);
      const task = await taskIn(created.id, 'done');
      const checks = resultOf(task).checks as Json[];
      assert.deepEqual(
        checks.map((c) => [c.name, c.ok, c.retried]),
        [
          '결과물 파일',
          '앱 코드 묶음',
          '디자인 기준',
          '디자인 문서',
          '템플릿 문법',
          '데이터 이름',
        ].map((n) => [n, true, false]),
      );
      const bodies = events(task).map((e) => String(e.body));
      assert.ok(bodies.includes('고칠 앱 코드(시작 코드)를 받았어요'), bodies.join(' | '));

      const code = await codeOf(app);
      assert.equal(code.current, 1, '비공개 앱의 새 버전은 바로 보인다');
      assert.equal((code.versions as Json[])[0]?.source, 'task');
      const files = (code.files as Json[]).map((f) => f.name);
      assert.ok(
        files.includes('header.html') && files.includes('style.css'),
        '내지 않은 시작 코드는 남는다',
      );
      const { url } = ok(await api.request('POST', `/api/apps/${app.id}/code/preview`, owner, {}));
      const ticket = String(url).split('~')[1];
      const screen = ok(await api.get(`/api/apps/site/${app.slug}/screen?path=&ticket=${ticket}`));
      assert.match(String((screen.templates as Json)['index.html']), /fake-made/);
      await roomsLeft();
    });

    test('앱 코드: 템플릿 문법이 틀리면 한 번 더 맡기고, 고치면 버전이 되고 그래도 틀리면 버전 없이 실패한다', async () => {
      const fixedApp = await newApp(`e2e-fix-${randomUUID().slice(0, 6)}`);
      const fixRuns = new Runs();
      const fixed = await appTask(`[fake:app-broken] [fake:app-fix] ${fixRuns.mark}`, fixedApp);
      const done = await taskIn(fixed.id, 'done');
      assert.equal(fixRuns.count(), 2);
      const syntax = (resultOf(done).checks as Json[]).find((c) => c.name === '템플릿 문법');
      assert.deepEqual([syntax?.ok, syntax?.retried], [true, true]);
      assert.equal((await codeOf(fixedApp)).current, 1);

      const brokenApp = await newApp(`e2e-broken-${randomUUID().slice(0, 6)}`);
      const runs = new Runs();
      const broken = await appTask(`[fake:app-broken] ${runs.mark}`, brokenApp);
      const failed = await taskIn(broken.id, 'failed');
      assert.equal(runs.count(), 2);
      assert.match(
        String(resultOf(failed).error),
        /템플릿 문법 검사에 떨어져 새 버전을 만들지 않았어요/,
      );
      const code = await codeOf(brokenApp);
      assert.deepEqual(
        [code.current, code.versions],
        [null, []],
        '틀린 템플릿은 버전이 되지 않는다',
      );
      await roomsLeft();
    });

    test('만든 파일이 없으면 한 번 더 맡기고, 그래도 없으면 실패로 끝낸다', async () => {
      const runs = new Runs();
      const task = await taskIn((await makeTask(runs.mark)).id, 'failed');
      assert.match(String(resultOf(task).error), /만든 파일이 없어요/);
      assert.deepEqual(resultOf(task).checks, [
        { name: '결과물 파일', ok: false, how: '없음', retried: true },
      ]);
      assert.equal(runs.count(), 2);
      await roomsLeft();
    });
  });

  // 4단계: 콘솔 › 코드(code-github)로 맡긴 일. 토큰으로 push하고 draft PR을 열고(가짜 GitHub API) 결재를 올린다.
  // 주인이 승인하면 끝나고, "고쳐 달라"면 같은 브랜치에서 이어서 고쳐 같은 PR이 갱신된다
  describe('code-github로 맡긴 일: PR과 결재', () => {
    const TOKEN = 'github_pat_e2e_only_0123456789';
    let github: FakeGithubApi;
    let repo: Json;
    let merger: Json;
    const worker = () => api.service(OutboxWorker);

    /** 코드 메뉴로 일을 맡기고 생긴 작업을 찾는다 (일꾼이 없어 직접 돌린다) */
    async function ask(marks: string): Promise<string> {
      const uniq = randomUUID().slice(0, 8);
      ok(
        await api.request('POST', `/api/p/code-github/repos/${repo.id}/tasks`, owner, {
          requestId: randomUUID(),
          instruction: `고쳐 주세요 ${uniq} ${marks}`,
          paths: ['src'],
          agentId: merger.id,
        }),
      );
      const task = await until('작업이 생김', async () => {
        await worker().tick();
        const { tasks } = ok(await api.get('/api/tasks', owner)) as { tasks: Json[] };
        return tasks.find((t) => String(t.title).includes(uniq)) ?? null;
      });
      return String(task.id);
    }

    /** 결재를 기다리는 작업의 결재 */
    async function approvalOf(taskId: string): Promise<Json> {
      return until('결재가 올라옴', async () => {
        const { approvals } = ok(await api.get('/api/approvals', owner)) as { approvals: Json[] };
        return approvals.find((a) => a.taskId === taskId && a.status === 'pending') ?? null;
      });
    }

    before(async () => {
      github = await FakeGithubApi.start(TOKEN);
      const url = git.create('me/app', {
        'src/a.ts': 'export const a = 1;\n',
        'README.md': '# app\n',
      });
      ok(await api.request('POST', '/api/plugins/code-github/enable', owner));
      ok(
        await api.request('PUT', '/api/plugins/code-github/settings', owner, {
          values: { token: TOKEN, apiUrl: github.url },
        }),
      );
      repo = ok(
        await api.request('POST', '/api/p/code-github/repos', owner, {
          name: 'app',
          url,
          base: 'main',
          setup: 'test -f README.md',
          checks: ['test -f src/a.ts'],
        }),
      );
      merger = await newAgent({
        name: 'PR 담당',
        scopes: ['read_public', 'code'],
        approvalActions: ['code.pr.merge'],
      });
    });

    after(() => github.close());

    test('토큰으로 push하고 draft PR을 열어 결재를 올린다. 주인이 승인하면 작업이 끝난다', async () => {
      const taskId = await ask('[fake:edit=src/a.ts]');
      await taskIn(taskId, 'waiting');
      const branch = `moida/${taskId}`;
      assert.deepEqual([...git.changed('me/app', branch)], ['src/a.ts']);
      const pull = github.open.find((p) => p.head === branch);
      assert.ok(pull, 'PR이 열림');
      assert.deepEqual([pull.base, pull.draft], ['main', true]);
      assert.ok(
        github.calls.every((c) => c.authorization === `Bearer ${TOKEN}`),
        'GitHub에는 패키지의 토큰으로',
      );
      const approval = await approvalOf(taskId);
      assert.equal(approval.action, 'code.pr.merge');
      assert.match(String(approval.note), /PR: https:\/\/github\.example\/me\/app\/pull\//);
      assert.match(String(approval.note), /검사 1개 통과/);
      const logs = slot.logs;
      assert.equal(logs.includes(TOKEN), false, '토큰은 로그에 없다');
      assert.equal(JSON.stringify(await getTask(taskId)).includes(TOKEN), false, '기록에도 없다');

      ok(
        await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
          version: approval.version,
          decision: 'approve',
        }),
      );
      await until('승인 뒤 끝남', async () => {
        await worker().tick();
        return (await getTask(taskId)).status === 'done' ? true : null;
      });
      const { pulls } = ok(await api.get('/api/p/code-github/pulls', owner)) as { pulls: Json[] };
      assert.equal(pulls.find((p) => p.taskId === taskId)?.status, 'merged');
      await roomsLeft();
    });

    test('"고쳐 달라"면 같은 브랜치에서 이어서 고치고, 같은 PR이 갱신되어 새 판으로 결재가 다시 올라온다', async () => {
      const taskId = await ask('[fake:edit=src/a.ts]');
      await taskIn(taskId, 'waiting');
      const first = await approvalOf(taskId);
      const branch = `moida/${taskId}`;
      ok(
        await api.request('POST', `/api/approvals/${first.id}/decide`, owner, {
          version: first.version,
          decision: 'revise',
          note: '테스트도 더해 주세요 [fake:edit=src/second.ts]',
        }),
      );
      const second = await until('다시 고쳐 결재가 올라옴', async () => {
        const next = await approvalOf(taskId);
        return next.id === first.id ? null : next;
      });
      const versionOf = (a: Json) => Number((a.target as Json).version);
      assert.equal(versionOf(second), versionOf(first) + 1, '판이 오른다');
      assert.deepEqual([...git.changed('me/app', branch)].sort(), ['src/a.ts', 'src/second.ts']);
      assert.equal(
        github.open.filter((p) => p.head === branch).length,
        1,
        'PR은 하나 (본문만 고침)',
      );
      assert.ok(github.calls.some((c) => c.method === 'PATCH'));
      await roomsLeft();
    });

    // 코드 작업 5단계의 끝났다는 기준: 팀장 하나가 셋으로 나누고, 칸 둘이 함께 돌아, PR 셋이 부딪치지 않고 머지된다
    test('대표가 경로로 셋으로 나누면 칸 둘이 함께 맡아 PR 셋이 부딪치지 않고, 모두 머지하면 대표도 끝난다', async () => {
      const url = git.create('me/split', {
        'src/a.ts': 'export const a = 1;\n',
        'README.md': '# split\n',
        'docs/index.md': '# docs\n',
      });
      const splitRepo = ok(
        await api.request('POST', '/api/p/code-github/repos', owner, {
          name: 'split',
          url,
          base: 'main',
          setup: 'test -f README.md',
          checks: ['test -f src/a.ts'],
        }),
      );
      const lead = await leadOf();
      const member = await newAgent({ name: '코드 일꾼', approvalActions: ['code.pr.merge'] });
      // 테스트용 CLI는 대표의 지시문에 실린 첫 일꾼에게 나눠 맡긴다: 이 일꾼만 남긴다
      const restore = await onlyWorkers([member]);
      const work2 = mkdtempSync(join(tmpdir(), 'moida-work-'));
      const pairing = join(spyDir, 'code-pairing-4');
      writeFileSync(pairing, api.service(ServerRunnerPolicy).codeSecret());
      const slot2 = RunnerProcess.start(api.baseUrl, {
        MOIDA_RUNNER_TOKEN: '',
        MOIDA_RUNNER_PAIRING_FILE: pairing,
        MOIDA_RUNNER_SLOT: '4',
        MOIDA_SANDBOX: '1',
        MOIDA_AGENT_USER: 'self',
        MOIDA_WORK_DIR: work2,
      });
      try {
        await slot2.logged('코드 러너 칸 4로 연결했어요');
        const uniq = randomUUID().slice(0, 8);
        ok(
          await api.request('POST', `/api/p/code-github/repos/${splitRepo.id}/tasks`, owner, {
            requestId: randomUUID(),
            instruction: `나눠서 고쳐 주세요 ${uniq} [fake:split=src/one,src/two,docs]`,
            paths: ['.'],
            agentId: lead.id,
          }),
        );
        const leadTask = await until('대표 작업이 생김', async () => {
          await worker().tick();
          const { tasks } = ok(await api.get('/api/tasks', owner)) as { tasks: Json[] };
          return tasks.find((t) => String(t.title).includes(uniq)) ?? null;
        });
        const parent = await until('하위 작업 셋', async () => {
          const task = await getTask(leadTask.id);
          return (task.children as Json[]).length === 3 ? task : null;
        });
        assert.equal(parent.status, 'waiting');
        const children = parent.children as Json[];
        for (const child of children) await taskIn(child.id, 'waiting');

        const branches = children.map((c) => `moida/${c.id}`);
        const changed = branches.map((b) => [...git.changed('me/split', b)]);
        for (const files of changed) assert.equal(files.length, 1, '하위 작업마다 제 경로만');
        assert.deepEqual(changed.flat().sort(), ['docs/x.ts', 'src/one/x.ts', 'src/two/x.ts']);
        assert.equal(github.open.filter((p) => branches.includes(p.head)).length, 3, 'PR 셋');
        const takers = [slot, slot2].filter((s) =>
          children.some((c) => s.logs.includes(`${c.id}: 일을 맡았어요`)),
        );
        assert.equal(takers.length, 2, '칸 둘이 함께 맡는다');

        for (const child of children) {
          const approval = await approvalOf(String(child.id));
          ok(
            await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
              version: approval.version,
              decision: 'approve',
            }),
          );
        }
        const done = await until('모두 머지한 뒤 대표가 끝남', async () => {
          await worker().tick();
          const task = await getTask(leadTask.id);
          return task.status === 'done' ? task : null;
        });
        assert.match(String((done.result as Json).text), /바꾼 파일이 없어/);
        const { pulls } = ok(await api.get('/api/p/code-github/pulls', owner)) as {
          pulls: Json[];
        };
        const mine = pulls.filter((p) => children.some((c) => c.id === p.taskId));
        assert.deepEqual(
          mine.map((p) => p.status),
          ['merged', 'merged', 'merged'],
        );
        await roomsLeft();
      } finally {
        await restore();
        assert.equal(await slot2.stop('SIGTERM'), 0);
        rmSync(work2, { recursive: true, force: true });
      }
    });
  });
});

// 웹 AI 로그인: 주인이 AI 메뉴에서 누르면 러너가 로그인 명령을 PTY(script)에서 대신 돌린다.
// 토큰 없이 뜬 러너(서버 러너와 같은 처지)가 로그인 일만 받아 로그인하고, 받은 토큰으로 이어서 일한다.
describe('웹 AI 로그인', () => {
  let runner: RunnerProcess;
  const toolOf = async (name: string): Promise<Json> => {
    const { tools } = ok(await api.get('/api/ai', owner)) as { tools: Json[] };
    return tools.find((t) => t.tool === name) as Json;
  };
  const begin = async (name: string): Promise<string> =>
    String(ok(await api.request('POST', `/api/ai/${name}/signin`, owner)).taskId);
  const step = (name: string, wanted: string): Promise<Json> =>
    until(`${name} 로그인이 ${wanted}`, async () => {
      const signin = (await toolOf(name)).signin as Json | null;
      return signin?.step === wanted ? signin : null;
    });
  const paste = async (taskId: string, code: string): Promise<void> => {
    ok(await api.request('POST', '/api/ai/claude/signin/code', owner, { taskId, code }));
  };

  before(async () => {
    await db.sql`DELETE FROM task.ai_logins`;
    runner = RunnerProcess.start(api.baseUrl, { CLAUDE_CODE_OAUTH_TOKEN: '' });
    await runner.logged('웹 로그인: claude, codex');
  });

  after(async () => {
    assert.equal(await runner.stop(), 0);
  });

  test('Claude: 토큰 없는 러너가 로그인 일만 받아 주소를 보이고, 붙여 넣은 코드로 받은 토큰으로 이어서 일한다', async () => {
    const spy = new Spy();
    const waiting = await newTask(await newAgent(), spy.mark);
    const taskId = await begin('claude');

    const shown = await step('claude', 'waiting_code');
    assert.match(String(shown.url), /^https:\/\/claude\.ai\/oauth\/authorize\?code=true&/);
    assert.equal(shown.userCode, null);
    assert.equal(
      (await getTask(waiting.id)).status,
      'queued',
      '토큰이 없으니 다른 일은 받지 않는다',
    );

    const code = `e2e${randomUUID().replaceAll('-', '')}#state`;
    await paste(taskId, code);
    const signin = await taskIn(taskId, 'done');
    const claude = await toolOf('claude');
    assert.equal(claude.connected, true);
    assert.ok(claude.expiresAt, 'Claude 토큰은 1년');

    const token = `sk-ant-oat01-fake_${code.replace('#', '_')}`;
    const seen = await spy.seen();
    assert.equal((seen.env as Json).CLAUDE_CODE_OAUTH_TOKEN, token, '받은 토큰으로 일한다');
    await taskIn(waiting.id, 'done');

    const record = `${JSON.stringify(signin)}\n${runner.logs}`;
    for (const secret of [code, token, 'claude.ai/oauth'])
      assert.equal(record.includes(secret), false, `${secret.slice(0, 16)}… 은 기록과 로그에 없다`);
    assert.ok(runner.logs.includes(`${taskId}: 붙여 넣은 코드를 넣었어요`));
    assert.ok(runner.logs.includes(`${taskId}: 로그인했어요`));
  });

  test('Claude: 틀린 코드면 실패로 끝나고 이유를 남긴다', async () => {
    const taskId = await begin('claude');
    await step('claude', 'waiting_code');
    await paste(taskId, 'wrong-code-1234');
    const failed = await taskIn(taskId, 'failed');
    assert.match(String((failed.result as Json).error), /코드가 맞지 않거나/);
    assert.equal(JSON.stringify(failed).includes('wrong-code-1234'), false);
  });

  test('취소하면 로그인 명령을 끄고 다음 일을 받는다', async () => {
    const taskId = await begin('claude');
    await step('claude', 'waiting_code');
    await cancelTask({ id: taskId });
    await runner.logged(`${taskId}: 주인이 취소했어요`);
    const next = await begin('claude');
    assert.notEqual(next, taskId);
    await step('claude', 'waiting_code');
    await cancelTask({ id: next });
    await runner.logged(`${next}: 주인이 취소했어요`);
  });

  test('Codex: 주소와 코드를 보이고, 로그인이 끝나면 auth.json을 만료 없이 저장한다', async () => {
    const taskId = await begin('codex');
    const shown = await step('codex', 'open_url');
    assert.equal(shown.url, 'https://auth.openai.com/codex/device');
    assert.equal(shown.userCode, 'FAKE-C0DE1');

    await taskIn(taskId, 'done');
    const codex = await toolOf('codex');
    assert.equal(codex.connected, true);
    assert.equal(codex.expiresAt, null);
    const [row] =
      await db.sql`SELECT octet_length(secret) AS size FROM task.ai_logins WHERE tool = 'codex'`;
    assert.ok(Number(row?.size) > 0, '잠가서 저장했다');
    assert.equal(runner.logs.includes('fake-refresh'), false);
  });
});

// Codex 구독으로 일하기: 공식 codex exec를 셸 없이 띄우고, 실행 중에 갱신된 auth.json을 서버에 되돌려 쓴다.
describe('Codex로 일한다', () => {
  let runner: RunnerProcess;
  const codexLogin = async (): Promise<Json> => {
    const { tools } = ok(await api.get('/api/ai', owner)) as { tools: Json[] };
    return tools.find((t) => t.tool === 'codex') as Json;
  };
  const codexAgent = () => newAgent({ tool: 'codex', name: 'Codex 글쓰기' });
  /** 서버에 저장된 Codex 자격 (러너가 받는 그대로) */
  const storedAuth = async (): Promise<Json> => {
    const name = `codex-reader-${randomUUID().slice(0, 8)}`;
    const device = await api.connectDevice(owner, name);
    const { devices } = ok(await api.get('/api/devices', owner)) as {
      devices: { id: string; name: string; version: number }[];
    };
    const row = devices.find((d) => d.name === name);
    ok(
      await api.request('PATCH', `/api/devices/${row?.id}`, owner, {
        scopes: ['run'],
        version: row?.version,
      }),
    );
    const res = await api.mcp(device, 'tools/call', {
      name: 'ai_login',
      arguments: { tool: 'codex' },
    });
    const body = (res.json().result as { structuredContent: Json }).structuredContent;
    return { ...JSON.parse(String(body.token)), version: body.version };
  };

  before(async () => {
    await db.sql`DELETE FROM task.ai_logins WHERE tool = 'codex'`;
    runner = RunnerProcess.start(api.baseUrl);
    await runner.logged('일할 수 있는 AI: claude, codex');
    const { taskId } = ok(await api.request('POST', '/api/ai/codex/signin', owner));
    await taskIn(taskId, 'done');
    assert.equal((await codexLogin()).connected, true);
  });

  after(async () => {
    assert.equal(await runner.stop(), 0);
  });

  test('공식 CLI를 셸 없이 띄워 결과와 토큰을 남기고, 스킬은 지시문에 넣는다', async () => {
    const spy = new Spy();
    const created = await newTask(await codexAgent(), spy.mark, {
      kind: 'draft_post',
      title: '초안',
    });
    const seen = await spy.seen();
    const task = await taskIn(created.id, 'done');
    assert.deepEqual(task.result, { text: 'codex 끝' });
    assert.equal(tokens(task), 220, '300 - 캐시 100 + 20');
    const [run] = task.runs as Json[];
    assert.ok(run);
    assert.equal(run.cliVersion, 'codex-cli 0.164.0');
    assert.equal(run.model, null, 'codex의 이벤트에는 모델이 없다');
    const skill = run.skill as Json;
    assert.deepEqual(
      { name: skill.name, source: skill.source },
      { name: 'moida-write', source: 'repo' },
    );
    const env = seen.env as Json;
    assert.ok(String(env.CODEX_HOME).length > 0);
    assert.notEqual(env.HOME, process.env.HOME, '빈 홈');
    assert.ok(String(env.MOIDA_RUN_TOKEN).length > 0, '작업 토큰은 환경 변수로만');
    assert.equal(env.MOIDA_RUNNER_TOKEN, undefined);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.ok(String(seen.config).includes('shell_tool = false'));
    assert.ok(String(seen.config).includes('[mcp_servers.moida]'));
    assert.ok(String(seen.prompt).includes('# 스킬: moida-write'), '셸이 없어 스킬은 지시문으로');
  });

  test('대화의 사진은 codex exec --image로 지시에 붙인다 (대화에 사진 넣기)', async () => {
    const lead = await leadOf();
    const tool = async (to: string): Promise<void> => {
      const { lead: now } = ok(await api.get('/api/agents/lead', owner)) as { lead: Json };
      ok(
        await api.request('PATCH', `/api/agents/${lead.id}`, owner, {
          tool: to,
          version: now.version,
        }),
      );
    };
    await tool('codex');
    try {
      const photo = await uploadPhoto('화이트보드.png');
      const spy = new Spy();
      ok(
        await api.request('POST', '/api/chats', owner, {
          requestId: randomUUID(),
          message: `이 사진 정리해 줘\n${spy.mark}`,
          refs: [{ kind: 'output', id: photo.id }],
        }),
        201,
      );
      const seen = await spy.seen();
      assert.deepEqual(seen.images, [{ path: 'photos/photo-1.png', sha256: sha256(photo.bytes) }]);
      const argv = seen.argv as string[];
      assert.deepEqual(argv.slice(0, 4), ['exec', '--image', 'photos/photo-1.png', '--json']);
      assert.ok(
        String(seen.prompt).includes(
          '화이트보드.png (비공개): 사진 · 이 지시에 붙인 그림 1번입니다',
        ),
      );
    } finally {
      await tool(String(lead.tool));
    }
  });

  test('실행 중에 갱신된 auth.json은 서버에 되돌려 쓰고, 다음 실행은 새 자격으로 돈다', async () => {
    const before = await storedAuth();
    const first = await newTask(await codexAgent(), '[fake:rotate]');
    await taskIn(first.id, 'done');
    await runner.logged(`${first.id}: 갱신된 codex 로그인을 서버에 저장했어요`);
    const after = await storedAuth();
    assert.notEqual(
      (after.tokens as Json).refresh_token,
      (before.tokens as Json).refresh_token,
      '바뀐 갱신 토큰이 저장됐다',
    );
    assert.equal(after.version, Number(before.version) + 1);

    const spy = new Spy();
    const second = await newTask(await codexAgent(), spy.mark);
    const seen = await spy.seen();
    await taskIn(second.id, 'done');
    const home = String((seen.env as Json).CODEX_HOME);
    assert.ok(home.length > 0);
    const record = `${JSON.stringify(await getTask(second.id))}\n${runner.logs}`;
    assert.equal(
      record.includes(String((after.tokens as Json).refresh_token)),
      false,
      '자격은 어디에도 남지 않는다',
    );
  });

  test('주인이 취소해도 그사이 갱신된 자격은 저장한다', async () => {
    const before = await storedAuth();
    const created = await newTask(await codexAgent(), '[fake:rotate] [fake:hang]');
    await taskIn(created.id, 'running');
    await new Promise((done) => setTimeout(done, 1_500)); // 가짜 CLI가 auth.json을 바꿀 시간
    await cancelTask(created);
    await runner.logged(`${created.id}: 갱신된 codex 로그인을 서버에 저장했어요`);
    const after = await storedAuth();
    assert.notEqual((after.tokens as Json).refresh_token, (before.tokens as Json).refresh_token);
  });

  test('작업 토큰(환경 변수)으로 moida MCP에 결재를 올린다', async () => {
    const created = await newTask(await codexAgent(), '[fake:approval]');
    await taskIn(created.id, 'waiting');
  });

  test('셸 명령이 보이면 끄고 failed, 답에 섞인 자격은 지운다', async () => {
    const shell = await newTask(await codexAgent(), '[fake:shell]');
    const failed = await taskIn(shell.id, 'failed');
    assert.match(String((failed.result as Json).error), /격리가 깨져 멈췄어요. 셸이 열려 있어요/);

    const leak = await newTask(await codexAgent(), '[fake:leak]');
    const done = await taskIn(leak.id, 'done');
    const refresh = String(((await storedAuth()).tokens as Json).refresh_token);
    assert.equal(JSON.stringify(done).includes(refresh), false);
    assert.ok(JSON.stringify(done).includes('[지움: 토큰]'));
  });
});

// browser-tabs 패키지: 주인이 콘솔(REST)에서 주소를 맡기면, 브라우저(MOIDA_BROWSER_URL)가 있는 러너가
// MCP로 받아 탭으로 열어 읽고 남긴다. 실제 Chromium으로 본다. 없으면 건너뛴다 (MOIDA_TEST_CHROMIUM으로 경로를 줄 수 있다)
const TAB_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>오늘의 글</title></head>
<body><h1>탭으로 읽은 본문</h1><p style="display:none">숨은 글자</p></body></html>`;

describe('브라우저 탭을 읽는다', { skip: TestChromium.skip }, () => {
  const PATH = '/api/p/browser-tabs/reads';
  let chromium: TestChromium;
  let site: Server;
  let siteUrl: string;

  const readOf = (url: string): Promise<Json> =>
    until(`${url} 읽기가 끝남`, async () => {
      const { reads } = ok(await api.get(PATH, owner)) as { reads: Json[] };
      return reads.find((r) => r.url === url && r.status !== 'requested') ?? null;
    });

  before(async () => {
    ok(await api.request('POST', '/api/plugins/browser-tabs/enable', owner));
    site = createServer((_, res) =>
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(TAB_PAGE),
    );
    await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
    siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
    chromium = await TestChromium.start();
  });

  after(async () => {
    await chromium.stop();
    site.close();
    ok(await api.request('POST', '/api/plugins/browser-tabs/disable', owner));
  });

  test('맡긴 주소를 러너가 탭으로 열어 읽어 남기고, 열리지 않는 주소는 이유를 남긴다', async () => {
    const page = `${siteUrl}/private/${randomUUID()}`;
    const broken = 'http://127.0.0.1:1/nothing';
    for (const url of [page, broken]) {
      const made = await api.request('POST', PATH, owner, { url });
      assert.ok([200, 201].includes(made.status), made.text);
    }

    const runner = RunnerProcess.start(api.baseUrl, {
      MOIDA_BROWSER_URL: `${chromium.endpoint}/`,
    });
    try {
      await runner.logged('브라우저 탭 읽기를 켰어요');
      const done = await readOf(page);
      assert.equal(done.status, 'done');
      assert.equal(done.title, '오늘의 글');
      assert.match(String(done.preview), /탭으로 읽은 본문/);
      assert.doesNotMatch(String(done.preview), /숨은 글자/);

      const failed = await readOf(broken);
      assert.equal(failed.status, 'failed');
      assert.match(String(failed.error), /주소를 열지 못했어요/);

      assert.equal((await chromium.openUrls()).includes(page), false, '읽은 탭은 닫는다');
      await runner.logged('브라우저 탭을 읽었어요: 127.0.0.1');
      assert.equal(runner.logs.includes('/private/'), false, '로그에는 주소의 호스트만');
    } finally {
      runner.signal('SIGTERM');
      await newTask(await newAgent(), ''); // 긴 폴링을 깨워 바로 끝나게 한다
      assert.equal(await runner.exited(), 0);
    }
  });
});

// 브라우저 작업(browse, 2차 3단계): 서버 러너가 브라우저(MOIDA_BROWSER_URL)에 붙어 있을 때만 받고, browser_job으로 어디서 돌지 받아
// AI CLI에 Playwright MCP를 붙인다. 가짜 CLI([fake:browse])는 Playwright MCP 대신 CDP로 직접 시작 주소를 열어 채우고 멈춘다.
// 그 뒤는 진짜다: 러너가 버튼을 다시 찾아 붙잡고 결재를 올리고, 승인되면 같은 버튼인지 보고 누른다 (진짜 Chromium + 시험 사이트).
// 브라우저에 닿지 못하면 실패로 끝내지 않고 돌려준다.
describe('브라우저 작업', { skip: TestChromium.skip }, () => {
  const BASE = '/api/p/browser-tabs';
  let chromium: TestChromium;
  let site: Server;
  let port: number;
  /** 시험 사이트에 간 게시(POST)의 본문 */
  const posts: string[] = [];
  /** 시험 사이트의 로그인 칸으로 온 로그인(POST /session)의 본문 */
  const logins: string[] = [];
  /** 로그인 카드로 넣는 테스트용 비밀번호 (어디에도 남지 않는지 본다) */
  const PASSWORD = `pw-${randomUUID()}`;
  const worker = () => api.service(OutboxWorker);
  const drain = async () => {
    for (let i = 0; i < 200 && (await worker().tick()) > 0; i++);
  };

  const browseAgent = async (): Promise<Json> =>
    ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: '브라우저 담당',
        role: '사이트의 편집기에 글을 채운다',
        tool: 'claude',
        scopes: ['read_public', 'browse'],
        approvalActions: ['browser.site.publish', 'browser.site.login'],
      }),
      201,
    );
  /** 사이트를 등록한다. host: 127.0.0.1 · localhost (쿠키가 호스트마다 따로라 로그인을 나눠 본다) */
  const newSite = async (host = '127.0.0.1'): Promise<Json> => {
    const origin = `http://${host}:${port}`;
    return ok(
      await api.request('POST', `${BASE}/sites`, owner, {
        name: '시험 블로그',
        startUrl: `${origin}/form`,
        origins: [origin],
      }),
    );
  };
  /** 사이트에 일을 맡기고 코어가 작업을 만들 때까지 */
  const ask = async (siteRow: Json, agent: Json, marks: string): Promise<Json> => {
    const requestId = randomUUID();
    ok(
      await api.request('POST', `${BASE}/sites/${siteRow.id}/tasks`, owner, {
        requestId,
        instruction: `제목 칸에 시험 글을 채워 주세요 ${marks}`,
        agentId: agent.id,
      }),
    );
    await drain();
    const [row] = await db.sql`
      SELECT id FROM task.tasks WHERE request_id = ${`browser-tabs:${requestId}`}`;
    return getTask(row?.id);
  };
  const serverRunner = (browserUrl: string): RunnerProcess => {
    const file = join(spyDir, `pairing-${randomUUID()}`);
    writeFileSync(file, api.service(ServerRunnerPolicy).secret());
    return RunnerProcess.start(api.baseUrl, {
      MOIDA_RUNNER_TOKEN: '',
      MOIDA_RUNNER_PAIRING_FILE: file,
      MOIDA_BROWSER_URL: browserUrl,
    });
  };
  const stopRunner = async (runner: RunnerProcess): Promise<void> => {
    runner.signal('SIGTERM');
    await newTask(await newAgent(), ''); // 긴 폴링을 깨워 바로 끝나게 한다
    assert.equal(await runner.exited(), 0);
  };
  /** 작업의 기다리는 결재 (없으면 null) */
  const pendingNow = async (taskId: unknown): Promise<Json | null> => {
    const { approvals } = ok(await api.get('/api/approvals?status=pending', owner)) as {
      approvals: Json[];
    };
    return approvals.find((a) => a.taskId === taskId) ?? null;
  };
  /** 작업이 결재를 기다리게 될 때까지, 그 결재 */
  const pendingOf = (taskId: unknown): Promise<Json> =>
    until('결재가 올라옴', () => pendingNow(taskId), 30_000);
  const decide = async (approval: Json, decision: string, note?: string) => {
    ok(
      await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
        version: approval.version,
        decision,
        ...(note ? { note } : {}),
      }),
    );
    await drain();
  };
  /** 결재 뒤의 일(클릭 고리 · 결과)은 일꾼을 돌리며 기다린다 */
  const settled = (taskId: unknown, status: string): Promise<Json> =>
    until(
      `작업이 ${status}`,
      async () => {
        await drain();
        const task = await getTask(taskId);
        return task.status === status ? task : null;
      },
      30_000,
    );
  /** 관리자가 콘솔 화면에서 로그인한 것처럼: 그 호스트에 로그인 쿠키를 받는다 */
  const signIn = async (host: string) => {
    await fetch(`${chromium.endpoint}/json/new?http://${host}:${port}/signin`, { method: 'PUT' });
    await until('로그인됨', async () => {
      const tabs = (await (await fetch(`${chromium.endpoint}/json/list`)).json()) as Json[];
      return tabs.some((t) => String(t.title) === '로그인됨') ? true : null;
    });
  };

  /** 그 호스트의 로그인 쿠키를 지운다 */
  const signOut = async (host: string) => {
    await fetch(`${chromium.endpoint}/json/new?http://${host}:${port}/signout`, { method: 'PUT' });
    await until('로그아웃됨', async () => {
      const tabs = (await (await fetch(`${chromium.endpoint}/json/list`)).json()) as Json[];
      return tabs.some((t) => String(t.title) === '로그아웃됨') ? true : null;
    });
  };

  before(async () => {
    ok(await api.request('POST', `/api/plugins/browser-tabs/enable`, owner));
    // 시험 사이트: /signin에 들어오면 로그인 쿠키, /form은 로그인했으면 글쓰기 · 아니면 로그인 화면, 게시(POST)는 기록
    site = createServer((req, res) => {
      const html = (body: string, headers: Json = {}) =>
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers }).end(body);
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => {
          body += c;
        });
        req.on('end', () => {
          // 로그인 칸으로 온 로그인 (로그인 카드): 맞는 비밀번호면 로그인 쿠키
          if (req.url?.startsWith('/session')) {
            logins.push(body);
            const right = new URLSearchParams(body).get('pw') === PASSWORD;
            return right
              ? html('<title>로그인됨</title>', { 'set-cookie': 'sid=ok; Path=/' })
              : html('<title>로그인</title><p>틀렸어요</p>');
          }
          posts.push(body);
          html('<title>완료</title><p>게시했어요</p>');
        });
        return;
      }
      if (req.url?.startsWith('/signout'))
        return html('<title>로그아웃됨</title>', { 'set-cookie': 'sid=; Path=/; Max-Age=0' });
      if (req.url?.startsWith('/signin'))
        return html('<title>로그인됨</title>', { 'set-cookie': 'sid=ok; Path=/' });
      if (!String(req.headers.cookie).includes('sid=ok'))
        return html(
          '<title>로그인</title><form action="/session" method="post"><label>아이디 <input name="id"></label><label>비밀번호 <input name="pw" type="password"></label><button type="submit">로그인</button></form>',
        );
      html(
        '<title>글쓰기</title><form action="/done" method="post"><input id="title" name="title"><button type="submit">게시</button></form>',
      );
    });
    await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
    port = (site.address() as AddressInfo).port;
    chromium = await TestChromium.start();
    await signIn('127.0.0.1');
  });
  after(async () => {
    await chromium.stop();
    site.closeAllConnections();
    site.close();
    ok(await api.request('POST', `/api/plugins/browser-tabs/disable`, owner));
  });

  test('브라우저에 닿지 못하면 AI를 띄우지 않고 돌려준다 (실패가 아니다)', async () => {
    const spy = new Spy();
    const task = await ask(await newSite(), await browseAgent(), spy.mark);
    const runner = serverRunner('http://127.0.0.1:1');
    try {
      await runner.logged('브라우저 작업: 받음');
      await runner.logged(`${task.id}: 브라우저에 닿지 못해 돌려줘요`);
      const back = await until('돌려줌', async () => {
        const t = await getTask(task.id);
        return events(t).some((e) => String(e.body).includes('브라우저에 닿지 못해요')) ? t : null;
      });
      // 돌려준 뒤 러너가 곧바로 다시 빌릴 수 있어 대기 · 실행 중 어느 쪽이든 된다. 실패로 끝나지 않으면 된다
      assert.ok(['queued', 'running'].includes(String(back.status)), String(back.status));
      assert.equal(existsSync(spy.path), false, 'AI CLI는 뜨지 않았다');
    } finally {
      await cancelTask(task);
      await stopRunner(runner);
    }
  });

  test('사이트 일 끝까지: 채우고 멈춤 → 러너가 붙잡아 결재 → 승인 → 같은 버튼이라 누르고 결과 화면 → done', async () => {
    const spy = new Spy();
    const siteRow = await newSite();
    const task = await ask(siteRow, await browseAgent(), `[fake:browse] ${spy.mark}`);
    const runner = serverRunner(chromium.endpoint);
    try {
      const seen = await spy.seen();
      const playwright = (seen.mcpServers as Json).playwright as Json;
      const args = (playwright.args as string[]).slice(1);
      assert.deepEqual(args.slice(0, 4), [
        '--cdp-endpoint',
        chromium.endpoint,
        '--allowed-origins',
        `http://127.0.0.1:${port}`,
      ]);
      assert.equal(args[4], '--output-dir');
      assert.ok((seen.argv as string[]).includes('mcp__playwright__*'), '그 도구를 묻지 않고 허락');
      assert.match(String(seen.prompt), /# 사이트: 시험 블로그[\s\S]*browser-stop\.json/);
      assert.equal(
        JSON.stringify(playwright).includes(String(seen.runToken)),
        false,
        '작업 토큰은 moida에만',
      );

      const approval = await pendingOf(task.id);
      assert.deepEqual(
        [approval.action, (approval.target as Json).kind, approval.note],
        ['browser.site.publish', 'browser_click', '제목을 채웠어요'],
      );
      const click = ok(await api.get(`${BASE}/clicks/${(approval.target as Json).id}`, owner));
      assert.deepEqual(
        [click.status, click.role, click.name, click.pageUrl],
        ['held', 'button', '게시', `http://127.0.0.1:${port}/form`],
      );
      assert.ok(click.beforeImage, '멈춘 화면');
      assert.deepEqual(
        (click.shots as Json[]).map((s) => s.kind),
        ['step', 'before'],
        'AI의 단계 화면 + 멈춘 화면',
      );
      assert.equal(posts.length, 0, '결재 전에는 누르지 않는다');

      await decide(approval, 'approve');
      const done = await settled(task.id, 'done');
      assert.ok(done);
      assert.deepEqual(posts, ['title=%EC%8B%9C%ED%97%98+%EA%B8%80'], '채운 값으로 한 번 게시했다');
      const after = ok(await api.get(`${BASE}/clicks/${click.id}`, owner));
      assert.deepEqual(
        [after.status, after.afterUrl, after.afterKind],
        ['clicked', `http://127.0.0.1:${port}/done`, 'after'],
      );
      await runner.logged(`결재된 클릭을 눌렀어요: ${click.id} (127.0.0.1:${port})`);
    } finally {
      await stopRunner(runner);
    }
  });

  test('승인 전에 페이지가 바뀌면 누르지 않고(changed) 작업은 실패, 사이트에는 요청이 가지 않는다', async () => {
    const task = await ask(await newSite(), await browseAgent(), '[fake:browse]');
    const runner = serverRunner(chromium.endpoint);
    try {
      const approval = await pendingOf(task.id);
      const clickId = (approval.target as Json).id;
      const click = ok(await api.get(`${BASE}/clicks/${clickId}`, owner));
      // 관리자가 콘솔 화면에서 그 페이지를 바꿨다 (버튼이 보내는 곳이 달라짐)
      const tab = ((await (await fetch(`${chromium.endpoint}/json/list`)).json()) as Json[]).find(
        (t) => t.id === click.tabId || t.url === click.pageUrl,
      );
      const ws = new WebSocket(String(tab?.webSocketDebuggerUrl));
      await new Promise((done) => ws.addEventListener('open', done, { once: true }));
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: "document.querySelector('form').action = '/elsewhere'" },
        }),
      );
      await new Promise((done) => ws.addEventListener('message', done, { once: true }));
      ws.close();
      const before = posts.length;

      await decide(approval, 'approve');
      const failed = await settled(task.id, 'failed');
      assert.match(
        String((failed.result as Json).error),
        /페이지가 바뀌어 누르지 않았어요 \(버튼이 달라요\)/,
      );
      assert.equal(posts.length, before, '누르지 않았다');
      const after = ok(await api.get(`${BASE}/clicks/${clickId}`, owner));
      assert.deepEqual([after.status, after.afterKind], ['changed', 'changed']);
    } finally {
      await stopRunner(runner);
    }
  });

  test('로그인이 풀려 있으면 로그인 필요 결재 → 콘솔에서 로그인하고 "로그인했어요" → 같은 작업이 이어서 끝까지', async () => {
    // localhost는 아직 로그인하지 않은 사이트다
    const siteRow = await newSite('localhost');
    const task = await ask(siteRow, await browseAgent(), '[fake:browse]');
    const runner = serverRunner(chromium.endpoint);
    try {
      const login = await pendingOf(task.id);
      assert.deepEqual(
        [login.action, (login.target as Json).kind, (login.target as Json).id],
        ['browser.site.login', 'browser_site', siteRow.id],
      );
      assert.match(String(login.note), /로그인 필요: 시험 블로그/);
      const flagged = (ok(await api.get(`${BASE}/sites`, owner)).sites as Json[]).find(
        (s) => s.id === siteRow.id,
      );
      assert.notEqual(flagged?.loginNeededAt, null);

      await signIn('localhost');
      await decide(login, 'revise', '로그인했어요');
      const publish = await until(
        '이어서 클릭 결재가 올라옴',
        async () => {
          await drain();
          const next = await pendingNow(task.id);
          return next?.action === 'browser.site.publish' ? next : null;
        },
        30_000,
      );
      const cleared = (ok(await api.get(`${BASE}/sites`, owner)).sites as Json[]).find(
        (s) => s.id === siteRow.id,
      );
      assert.equal(cleared?.loginNeededAt, null, '로그인했어요로 표시를 비웠다');
      await decide(publish, 'approve');
      await settled(task.id, 'done');
      const { shots } = ok(await api.get(`${BASE}/shots?taskId=${task.id}`, owner)) as {
        shots: Json[];
      };
      assert.deepEqual(
        shots.map((s) => s.kind),
        ['login', 'step', 'before', 'after'],
      );
    } finally {
      await stopRunner(runner);
    }
  });

  test('로그인 카드: AI가 알린 칸에 관리자가 넣으면 러너가 AI 없이 로그인하고, 같은 작업이 이어서 끝까지 (값은 남지 않는다)', async () => {
    await signOut('localhost');
    const siteRow = await newSite('localhost');
    const task = await ask(siteRow, await browseAgent(), '[fake:browse] [fake:login-form]');
    const runner = serverRunner(chromium.endpoint);
    try {
      const login = await pendingOf(task.id);
      assert.match(String(login.note), /로그인 필요: 시험 블로그\. 카드의 칸에 넣어/);
      const card = ok(await api.get(`${BASE}/sites/${siteRow.id}/login`, owner));
      assert.deepEqual(card.fields, [{ kind: 'id' }, { kind: 'password' }]);
      assert.equal(card.origin, `http://localhost:${port}`);

      ok(
        await api.request('POST', `${BASE}/sites/${siteRow.id}/login`, owner, {
          values: { id: 'me', password: PASSWORD },
        }),
      );
      const done = await until(
        '러너가 넣고 누름',
        async () => {
          const now = ok(await api.get(`${BASE}/sites/${siteRow.id}/login`, owner));
          const attempt = now.attempt as Json | null;
          return attempt && attempt.status !== 'sent' && attempt.status !== 'filling'
            ? attempt
            : null;
        },
        30_000,
      );
      assert.equal(done.status, 'submitted', JSON.stringify({ ...done, image: null }));
      assert.equal(done.afterUrl, `http://localhost:${port}/session`);
      assert.equal(new URLSearchParams(logins.at(-1)).get('pw'), PASSWORD, '값은 사이트로 갔다');

      // 카드가 하는 일: 로그인 뒤 "로그인했어요"로 같은 작업을 잇는다
      await decide(login, 'revise', '로그인했어요');
      const publish = await until(
        '이어서 클릭 결재가 올라옴',
        async () => {
          await drain();
          const next = await pendingNow(task.id);
          return next?.action === 'browser.site.publish' ? next : null;
        },
        30_000,
      );
      await decide(publish, 'approve');
      await settled(task.id, 'done');

      // 값은 러너 로그 · 실행 기록 · 결재 · 패키지 표 어디에도 없다
      assert.equal(runner.logs.includes(PASSWORD), false);
      const [found] = await db.sql<{ n: number }[]>`
        SELECT (SELECT count(*) FROM task.task_events WHERE body LIKE ${`%${PASSWORD}%`})
          + (SELECT count(*) FROM task.approvals WHERE coalesce(note, '') LIKE ${`%${PASSWORD}%`})
          + (SELECT count(*) FROM browser_tabs.sites WHERE coalesce(login_form::text, '') LIKE ${`%${PASSWORD}%`})
          + (SELECT count(*) FROM task.tasks WHERE coalesce(result::text, '') LIKE ${`%${PASSWORD}%`}) AS n`;
      assert.equal(Number(found?.n), 0);
    } finally {
      await stopRunner(runner);
    }
  });

  test('둘러보기: 새 빈 창(--isolated)과 내부 주소를 막는 프록시로 돌고, 사이트 자리를 쓰지 않는다', async () => {
    const spy = new Spy();
    const agent = await browseAgent();
    const requestId = randomUUID();
    ok(
      await api.request('POST', `${BASE}/explore`, owner, {
        requestId,
        instruction: `가격을 비교해 주세요 ${spy.mark}`,
        agentId: agent.id,
      }),
    );
    await drain();
    const runner = serverRunner(chromium.endpoint);
    try {
      const seen = await spy.seen();
      const args = (((seen.mcpServers as Json).playwright as Json).args as string[]).slice(1);
      assert.deepEqual(args.slice(0, 4), [
        '--cdp-endpoint',
        chromium.endpoint,
        '--isolated',
        '--proxy-server',
      ]);
      assert.match(String(args[4]), /^http:\/\/127\.0\.0\.1:\d+$/);
      const argv = seen.argv as string[];
      assert.deepEqual(
        argv.slice(argv.indexOf('--disallowedTools') + 1, argv.indexOf('--disallowedTools') + 3),
        ['mcp__playwright__browser_evaluate', 'mcp__playwright__browser_file_upload'],
        '페이지에서 스크립트 돌리기 · 파일 올리기는 막는다 (2026-11-24)',
      );
      assert.match(String(seen.prompt), /# 둘러보기/);
      const [row] =
        await db.sql`SELECT id FROM task.tasks WHERE request_id = ${`browser-tabs:${requestId}`}`;
      await taskIn(row?.id, 'done');
    } finally {
      await stopRunner(runner);
    }
  });
});

describe('러너를 멈춘다', () => {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    test(`${signal}이면 AI CLI를 끄고 일을 돌려준 뒤 0으로 끝난다`, async () => {
      const agent = await newAgent();
      const runner = RunnerProcess.start(api.baseUrl);
      const spy = new Spy();
      const created = await newTask(agent, `${spy.mark} [fake:hang]`);
      const seen = await spy.seen();
      await taskIn(created.id, 'running');

      assert.equal(await runner.stop(signal), 0);

      await gone(seen.pid);
      const task = await getTask(created.id);
      assert.equal(task.status, 'queued');
      assert.ok(events(task).some((e) => e.body === '돌려줌: 러너가 멈춰요'));
      assert.equal(existsSync(String(seen.cwd)), false);
    });
  }

  test('동시에 2개면 두 일이 함께 돌고, 멈추면 AI CLI를 모두 끄고 둘 다 돌려준다', async () => {
    const agent = await newAgent();
    const runner = RunnerProcess.start(api.baseUrl, { MOIDA_RUNNER_CONCURRENCY: '2' });
    await runner.logged('동시에 하는 일: 2개까지');
    const spies = [new Spy(), new Spy()];
    const created: Json[] = [];
    for (const spy of spies) created.push(await newTask(agent, `${spy.mark} [fake:hang]`));
    const seen = await Promise.all(spies.map((spy) => spy.seen()));
    for (const task of created) await taskIn(task.id, 'running');
    assert.deepEqual(
      seen.map((s) => alive(s.pid)),
      [true, true],
      '두 AI CLI가 같은 때에 살아 있다',
    );
    assert.notEqual(seen[0]?.cwd, seen[1]?.cwd, '일마다 자리가 따로');

    assert.equal(await runner.stop('SIGTERM'), 0);

    for (const s of seen) await gone(s.pid);
    for (const task of created) {
      const back = await getTask(task.id);
      assert.equal(back.status, 'queued');
      assert.ok(events(back).some((e) => e.body === '돌려줌: 러너가 멈춰요'));
    }
    for (const s of seen) assert.equal(existsSync(String(s.cwd)), false);
  });

  test('일을 기다리다 멈추면 그사이 온 일을 돌려준다', async () => {
    const agent = await newAgent();
    const runner = RunnerProcess.start(api.baseUrl);
    await runner.logged('러너를 시작했어요');
    await new Promise((done) => setTimeout(done, 300)); // next_jobs가 서버에 닿기를 기다린다
    runner.signal('SIGTERM');
    await runner.logged('기다리는 요청이 끝나면 멈춰요');

    const created = await newTask(agent, '');

    assert.equal(await runner.exited(), 0);
    const task = await getTask(created.id);
    assert.equal(task.status, 'queued');
    assert.ok(events(task).some((e) => e.body === '돌려줌: 러너가 멈춰요'));
  });

  test('설치된 AI CLI가 없으면 일을 받지 않고 알린다. 일은 대기열에 그대로 남는다', async () => {
    const created = await newTask(await newAgent(), '');
    const bare = RunnerProcess.start(api.baseUrl, {
      MOIDA_RUNNER_CLI: '/없는/claude',
      MOIDA_RUNNER_CODEX_CLI: '/없는/codex',
    });
    await bare.logged('쓸 수 있는 AI CLI가 없어요');
    await new Promise((done) => setTimeout(done, 1_500));
    const task = await getTask(created.id);
    assert.equal(task.status, 'queued', '빌렸다 돌려주지 않는다');
    assert.equal(task.attempts, 0);
    bare.signal('SIGTERM');
    await newTask(await newAgent(), ''); // 긴 폴링을 깨워 바로 끝나게 한다
    assert.equal(await bare.exited(), 0);
  });

  test('로그인이 없는 도구의 일은 받지 않고, 다른 일은 계속 한다', async () => {
    await db.sql`DELETE FROM task.ai_logins WHERE tool = 'codex'`;
    const codexWork = await newTask(await newAgent({ tool: 'codex' }), '');
    const runner = RunnerProcess.start(api.baseUrl);
    const next = await newTask(await newAgent(), '');
    await taskIn(next.id, 'done');
    await runner.logged(`${next.id}: 끝났어요`);
    const held = await getTask(codexWork.id);
    assert.equal(held.status, 'queued', 'Codex 일은 로그인이 생길 때까지 기다린다');
    assert.equal(held.attempts, 0);
    runner.signal('SIGTERM');
    await newTask(await newAgent(), ''); // 긴 폴링을 깨워 바로 끝나게 한다
    assert.equal(await runner.exited(), 0);
  });

  test('기기 토큰이 틀리면 바로 멈춘다', async () => {
    const denied = RunnerProcess.start(api.baseUrl, { MOIDA_RUNNER_TOKEN: 'moida_wrong' });
    assert.equal(await denied.exited(), 1);
    assert.ok(denied.logs.includes('기기 토큰이 맞지 않아요'), denied.logs);
  });

  test('run 권한이 없는 기기는 바로 멈춘다', async () => {
    const laptop = await api.connectDevice(owner, 'e2e-laptop');
    const denied = RunnerProcess.start(api.baseUrl, { MOIDA_RUNNER_TOKEN: laptop });
    assert.equal(await denied.exited(), 1);
    assert.ok(denied.logs.includes("'run' 권한"), denied.logs);
  });

  test('설정이 빠지면 짧은 문구로 멈춘다', async () => {
    const blank = RunnerProcess.start(api.baseUrl, { MOIDA_RUNNER_TOKEN: '' });
    assert.equal(await blank.exited(), 1);
    assert.ok(blank.logs.includes('러너 설정이 빠졌어요: MOIDA_RUNNER_TOKEN'), blank.logs);
  });

  // 끊긴 긴 폴링이 서버에 남으므로 일을 쓰는 테스트는 이 앞에 둔다
  test('두 번째 신호는 기다리지 않고 바로 끝낸다', async () => {
    const runner = RunnerProcess.start(api.baseUrl);
    await runner.logged('러너를 시작했어요');
    await new Promise((done) => setTimeout(done, 300));
    runner.signal('SIGTERM');
    await runner.logged('기다리는 요청이 끝나면 멈춰요');
    const signalled = Date.now();
    assert.equal(await runner.stop(), 0);
    assert.ok(Date.now() - signalled < 3000);
  });
});
