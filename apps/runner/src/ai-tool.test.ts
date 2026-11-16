import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { AiTool } from './ai-tool';
import { type EngineAdapter, EngineAdapters } from './engine-adapter';
import { Job } from './job';
import type { JobWorkspace } from './job-workspace';
import { Json } from './json';
import { RunnerConfig } from './runner-config';
import { REPO_PROMPTS } from './testing/repo-prompts';

// AI CLI 어댑터의 계약 (2차 7단계). 러너가 아는 모든 엔진(EngineAdapters.list())이 같은 약속을 지킨다:
// 빈 설정 홈, 허락한 MCP만(cairn · 허락한 외부 도구), 모르는 서버가 보이면 격리 깨짐, 비밀은 명령줄에 없고 지울 값에 있다,
// 모델 · 생각 강도가 CLI에 닿는다(받지 않는 강도는 넘기지 않는다), 셸이 있는 일에는 외부 도구를 붙이지 않는다.
// 진짜 CLI 대신 받은 명령줄 · 환경 · 표준 입력을 그대로 돌려주는 가짜 CLI를 띄우고, 어댑터가 쓴 설정 파일까지 읽어 본다.
// 어댑터는 엔진 등록부에서 만든다 (EngineAdapter.tool). 새 엔진은 SAMPLES에 한 줄을 더해야 이 시험이 통과한다 (maintainer의 PR도 같다).

const RUN_TOKEN = 'run-token-abcdef123456';
const HEADER_VALUE = 'Bearer tool-secret-987654';
const CLAUDE_TOKEN = 'sk-ant-oat01-contract-token';
const CODEX_AUTH = JSON.stringify({
  OPENAI_API_KEY: null,
  tokens: { access_token: 'access-contract-1234', refresh_token: 'refresh-contract-1234' },
});

/** 엔진마다: 받은 자격의 견본, 로그에서 지워야 할 값, 모르는 MCP 서버가 보이는 출력 한 줄 */
type Sample = {
  credential: string;
  secret: string;
  serverLine: (server: string) => string;
};

const SAMPLES: Readonly<Record<string, Sample>> = {
  claude: {
    credential: CLAUDE_TOKEN,
    secret: CLAUDE_TOKEN,
    serverLine: (server) =>
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        mcp_servers: [{ name: server, status: 'connected' }],
      }),
  },
  codex: {
    credential: CODEX_AUTH,
    secret: 'refresh-contract-1234',
    serverLine: (server) =>
      JSON.stringify({
        type: 'item.started',
        item: { id: 'i1', type: 'mcp_tool_call', server, tool: 'search' },
      }),
  },
};

/** 등록부의 어댑터로 이 엔진의 실행 어댑터를 만든다. 실행 파일은 가짜 CLI */
function make(engine: EngineAdapter): AiTool {
  const config = new RunnerConfig(
    'https://cairn.test',
    'device',
    {},
    { [engine.name]: bin },
    skills,
  );
  return engine.tool((SAMPLES[engine.name] as Sample).credential, config);
}

let root: string;
let bin: string;
let skills: string;

/** 일 하나. kind가 code면 셸이 있는 칸의 일 (외부 도구를 붙이지 않는다) */
function job(tool: string, more: { kind?: string; model?: string; effort?: string } = {}): Job {
  return Job.from(
    Json.of({
      task: { id: 'task-1', kind: more.kind ?? 'general', title: '조사', payload: {} },
      instruction: '찾아 주세요',
      agent: { name: '조사', role: '', tool, model: more.model ?? '', effort: more.effort ?? '' },
      run_token: RUN_TOKEN,
      tools: [
        {
          name: 'notion',
          title: 'Notion',
          url: 'https://mcp.notion.example.com/mcp',
          headers: { Authorization: HEADER_VALUE },
        },
      ],
    }),
  );
}

/** 폴더 아래 파일의 글을 모두 (설정 파일에 무엇을 썼는지) */
async function textUnder(dir: string): Promise<string> {
  const found = await stat(dir).catch(() => null);
  if (!found) return '';
  if (found.isFile()) return readFile(dir, 'utf8');
  const names = await readdir(dir);
  return (await Promise.all(names.map((n) => textUnder(join(dir, n))))).join('\n');
}

/** 어댑터로 가짜 CLI를 띄워, CLI가 받은 것(명령줄 · 환경 · 표준 입력)과 어댑터가 쓴 설정을 돌려준다 */
async function launch(adapter: AiTool, work: Job) {
  const workspace: JobWorkspace = await adapter.open(work);
  try {
    const lines: string[] = [];
    const proc = adapter.start(work, workspace, REPO_PROMPTS, (l) => lines.push(l));
    await proc.exited;
    const seen = JSON.parse(lines.join('')) as {
      argv: string[];
      env: Record<string, string>;
      stdin: string;
    };
    const config = `${await textUnder(workspace.configDir)}\n${await textUnder(workspace.mcpConfigPath)}`;
    return { ...seen, config, home: workspace.homeDir };
  } finally {
    await workspace.remove();
  }
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'ai-tool-contract-'));
  skills = join(root, 'skills');
  const fake = join(root, 'fake-cli.mjs');
  await writeFile(
    fake,
    `let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  console.log(JSON.stringify({ argv: process.argv.slice(2), env: process.env, stdin }));
});
`,
  );
  // 어댑터는 환경을 비워 띄운다 (PATH가 없을 수 있다): node를 절대 경로로 부르는 껍데기
  bin = join(root, 'fake-cli');
  await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
  await chmod(bin, 0o755);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('AI CLI 어댑터의 계약', () => {
  test('러너가 아는 모든 엔진이 이 계약 시험에 있다 (새 엔진은 SAMPLES에 더한다)', () => {
    assert.deepEqual(Object.keys(SAMPLES), [...EngineAdapters.names()]);
  });

  for (const engine of EngineAdapters.list()) {
    const tool = engine.name;
    const spec = SAMPLES[tool] as Sample;
    /** 그 엔진이 받는 가장 강한 생각 강도 */
    const strongest = engine.efforts.at(-1) as string;
    describe(tool, () => {
      test('설정 홈은 작업마다 새 폴더: 사용자의 홈 · 설정을 물려받지 않는다', async () => {
        const seen = await launch(make(engine), job(tool));
        assert.notEqual(seen.env.HOME, process.env.HOME);
        assert.equal(seen.env.HOME, seen.home);
      });

      test('MCP는 cairn과 허락한 외부 도구(x-<이름>)만. 지시문에 외부 도구의 답은 자료라는 단락', async () => {
        const seen = await launch(make(engine), job(tool));
        const given = `${seen.argv.join(' ')}\n${seen.config}`;
        assert.ok(given.includes('https://cairn.test/mcp'), 'cairn');
        assert.ok(given.includes('x-notion'), '외부 도구의 서버 이름');
        assert.ok(given.includes('https://mcp.notion.example.com/mcp'), '외부 도구의 주소');
        assert.match(seen.stdin, /# 외부 도구/);
        assert.match(seen.stdin, /x-notion/);
      });

      test('작업 토큰 · 외부 도구의 토큰은 명령줄에 없고(ps에 보임), 로그에서 지울 값에 있다', async () => {
        const adapter = make(engine);
        const work = job(tool);
        const seen = await launch(adapter, work);
        for (const secret of [RUN_TOKEN, HEADER_VALUE, spec.secret])
          assert.equal(seen.argv.join(' ').includes(secret), false, secret);
        const erased = [...adapter.secrets, ...work.runtime.secrets];
        assert.ok(erased.includes(HEADER_VALUE), '외부 도구의 머리글 값');
        assert.ok(erased.includes(spec.secret), 'AI 로그인의 자격');
      });

      test('붙인 서버는 격리 깨짐이 아니고, 붙이지 않은 서버가 보이면 깨짐', async () => {
        const adapter = make(engine);
        const workspace = await adapter.open(job(tool));
        try {
          const ok = adapter.stream();
          ok.read(spec.serverLine('x-notion'));
          assert.equal(ok.breach, null);
          const bad = adapter.stream();
          bad.read(spec.serverLine('x-gmail'));
          assert.match(bad.breach ?? '', /x-gmail/);
        } finally {
          await workspace.remove();
        }
      });

      test('셸이 있는 칸의 일(code)에는 외부 도구를 붙이지 않는다', async () => {
        const seen = await launch(make(engine), job(tool, { kind: 'code' }));
        const given = `${seen.argv.join(' ')}\n${seen.config}\n${JSON.stringify(seen.env)}`;
        assert.equal(given.includes('notion'), false);
        assert.equal(given.includes(HEADER_VALUE), false);
        assert.doesNotMatch(seen.stdin, /# 외부 도구/);
      });

      test('모델 · 생각 강도가 CLI에 닿는다. 비우면 넘기지 않고, 받지 않는 강도도 넘기지 않는다', async () => {
        const tuned = await launch(
          make(engine),
          job(tool, { model: 'contract-model-1', effort: strongest }),
        );
        const given = `${tuned.argv.join(' ')}\n${tuned.config}`;
        assert.ok(given.includes('contract-model-1'), '모델');
        assert.ok(given.includes(strongest), '강도');
        const plain = await launch(make(engine), job(tool, { effort: 'ultra' }));
        const none = `${plain.argv.join(' ')}\n${plain.config}`;
        assert.equal(none.includes('ultra'), false, '모르는 강도');
        assert.equal(none.includes('contract-model'), false);
      });
    });
  }
});
