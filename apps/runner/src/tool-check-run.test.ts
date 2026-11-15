import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Job } from './job';
import { Json } from './json';
import { McpProbe, ProbeFailed } from './mcp-probe';
import type { RunResult } from './progress';
import { Redactor, RunLog } from './redactor';
import { ToolCheckRun } from './tool-check-run';

// 커넥터 확인 일 (tool_check): AI 없이 도구 목록을 result.tools로, 실패면 까닭만

const SECRET = 'Bearer very-secret-token';

const jobOf = (tools: object[]) =>
  Job.from(Json.of({ task: { id: 't1', kind: 'tool_check', title: '커넥터 확인' }, tools }));

class FakeProbe extends McpProbe {
  constructor(private readonly answer: () => Promise<{ name: string; description: string }[]>) {
    super();
  }
  override async tools() {
    return this.answer();
  }
}

async function run(job: Job, probe: McpProbe) {
  const sent: RunResult[] = [];
  const server = { submit: async (_id: string, result: RunResult) => void sent.push(result) };
  const log = new RunLog(new Redactor([]));
  await new ToolCheckRun(
    job,
    server,
    new Redactor([]),
    log,
    new AbortController().signal,
    probe,
  ).perform();
  return sent;
}

const notion = {
  name: 'notion',
  url: 'https://mcp.example.com/mcp',
  headers: { Authorization: SECRET },
};

describe('ToolCheckRun', () => {
  test('도구 목록을 결과의 tools로 보낸다', async () => {
    assert.equal(jobOf([notion]).isToolCheck, true);
    const [result] = await run(
      jobOf([notion]),
      new FakeProbe(async () => [{ name: 'search', description: '찾기' }]),
    );
    assert.equal(result?.status, 'done');
    assert.deepEqual(result?.extra, { tools: [{ name: 'search', description: '찾기' }] });
  });

  test('실패는 까닭만, 토큰은 지운다', async () => {
    const [result] = await run(
      jobOf([notion]),
      new FakeProbe(async () => {
        throw new ProbeFailed(`MCP 오류: ${SECRET}`);
      }),
    );
    assert.equal(result?.status, 'failed');
    assert.ok(result?.error?.startsWith('MCP 오류'));
    assert.ok(!result?.error?.includes('very-secret-token'));
  });

  test('확인할 커넥터가 없으면 실패', async () => {
    const [result] = await run(jobOf([]), new FakeProbe(async () => []));
    assert.equal(result?.error, '확인할 커넥터가 없어요');
  });
});
