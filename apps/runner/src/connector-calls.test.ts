import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ClaudeStream } from './claude-stream';
import { CodexStream } from './codex-stream';
import { ConnectorCalls } from './connector-calls';
import { RunResult } from './progress';
import { Redactor } from './redactor';

// 커넥터(x-<이름>) 사용 세기 (2026-11-15 MCP 1단계): 두 CLI 모두, 결과의 connector_calls로 서버에 간다

const line = (value: object) => JSON.stringify(value);

describe('ConnectorCalls', () => {
  test('x- 서버만 세고, 같은 호출 id는 한 번, 실패는 호출 id나 서버 이름으로', () => {
    const calls = new ConnectorCalls();
    calls.called('x-notion', 'c1');
    calls.called('x-notion', 'c1');
    calls.called('x-notion', 'c2');
    calls.called('moida', 'c3');
    calls.called('x-linear');
    calls.failed('c2', '  권한이\n없어요 ');
    calls.failed('x-linear', '시간 초과');
    calls.failed('moida', '세지 않음');
    assert.deepEqual(calls.lines, [
      { name: 'notion', calls: 2, failures: 1, error: '권한이 없어요' },
      { name: 'linear', calls: 1, failures: 1, error: '시간 초과' },
    ]);
  });

  test('Claude 도구 이름에서 서버 이름', () => {
    assert.equal(ConnectorCalls.serverOf('mcp__x-notion__search'), 'x-notion');
    assert.equal(ConnectorCalls.serverOf('Read'), null);
  });
});

describe('스트림에서 세기', () => {
  test('Claude: tool_use로 세고 is_error인 tool_result로 실패', () => {
    const stream = new ClaudeStream();
    stream.read(
      line({
        type: 'assistant',
        message: {
          id: 'm1',
          content: [
            { type: 'tool_use', id: 't1', name: 'mcp__x-notion__search', input: {} },
            { type: 'tool_use', id: 't2', name: 'mcp__x-notion__fetch', input: {} },
            { type: 'tool_use', id: 't3', name: 'mcp__moida__get_session', input: {} },
          ],
        },
      }),
    );
    stream.read(
      line({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't2', is_error: true, content: '404 없음' },
          ],
        },
      }),
    );
    assert.deepEqual(stream.connectorCalls, [
      { name: 'notion', calls: 2, failures: 1, error: '404 없음' },
    ]);
  });

  test('Codex: mcp_tool_call 시작으로 세고 실패한 완료로 실패', () => {
    const stream = new CodexStream(['moida', 'x-linear']);
    const item = (phase: string, id: string, body: object) =>
      line({ type: `item.${phase}`, item: { id, type: 'mcp_tool_call', ...body } });
    stream.read(item('started', 'i1', { server: 'x-linear', tool: 'list_issues' }));
    stream.read(
      item('completed', 'i1', { server: 'x-linear', tool: 'list_issues', status: 'completed' }),
    );
    stream.read(item('started', 'i2', { server: 'x-linear', tool: 'get_issue' }));
    stream.read(
      item('completed', 'i2', {
        server: 'x-linear',
        tool: 'get_issue',
        status: 'failed',
        error: { message: '없는 이슈' },
      }),
    );
    assert.deepEqual(stream.connectorCalls, [
      { name: 'linear', calls: 2, failures: 1, error: '없는 이슈' },
    ]);
  });
});

describe('결과에 싣기', () => {
  test('끝난 일: text와 connector_calls. 오류 글의 비밀값은 지운다', () => {
    const redactor = new Redactor(['sk-secret-1']);
    const result = RunResult.from(
      {
        finalText: '끝',
        connectorCalls: [{ name: 'notion', calls: 1, failures: 1, error: 'bad sk-secret-1' }],
      },
      redactor,
    );
    assert.equal(result.status, 'done');
    assert.equal(result.text, '끝');
    const [call] = result.extra.connector_calls as { error: string }[];
    assert.ok(!call?.error.includes('sk-secret-1'));
  });

  test('부른 커넥터가 없으면 칸을 싣지 않는다', () => {
    const result = RunResult.failed('실패', new Redactor([]));
    assert.deepEqual(result.extra, {});
  });
});
