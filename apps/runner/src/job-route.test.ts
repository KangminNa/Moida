import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { JobRoute } from './job-route';
import { Json } from './json';
import { PromptPack } from './prompt-pack';

// 이 일의 방법 (C4 도구 우선순위, 2026-11-27): 대표가 delegate_task의 route로 정한 것을 서버가 payload.route로 싣는다
const PACK = PromptPack.read(resolve(__dirname, '../../../skills'));

test('mcp는 공식 MCP만 쓰고 넘어가지 않는다, web은 커넥터를 붙이지 않는다, 없거나 모르는 값이면 단락이 없다', () => {
  const mcp = JobRoute.from(Json.of({ route: 'mcp' }));
  assert.ok(mcp);
  assert.equal(mcp.skipsConnectors, false);
  const mcpPart = mcp.part(PACK);
  assert.match(mcpPart, /이 일의 방법/);
  assert.match(mcpPart, /공식 MCP\)만 씁니다/);
  assert.doesNotMatch(mcpPart, /커넥터\)는 쓰지 않습니다/);

  const web = JobRoute.from(Json.of({ route: 'web' }));
  assert.ok(web);
  assert.equal(web.skipsConnectors, true);
  assert.match(web.part(PACK), /커넥터\)는 쓰지 않습니다/);

  assert.equal(JobRoute.from(Json.of({})), null);
  assert.equal(JobRoute.from(Json.of({ route: 'browser' })), null);
});
