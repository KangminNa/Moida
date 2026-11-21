import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation, SecretBox } from '../../platform';
import { Agent } from '../agent/agent';
import type { AgentRow } from '../task.tables';
import { ExternalTool } from './external-tool';
import { ExternalToolUrl } from './external-tool-url.policy';

// 외부 도구 (2차 7단계)의 규칙. DB 없이 돈다.

const NOW = new Date('2026-11-16T00:00:00Z');
const box = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });
const fields = { title: 'Notion', url: 'https://mcp.notion.example.com/mcp' };

function agentWith(scopes: readonly string[], tools: readonly string[] = []): Agent {
  return Agent.restore({
    id: 'agent-1',
    version: 1,
    space_id: 'space',
    name: '조사',
    tool: 'claude',
    scopes,
    external_tools: tools,
    reports_to: null,
    status: Agent.ACTIVE,
    deleted_at: null,
  } as unknown as AgentRow);
}

describe('외부 도구의 주소 (ExternalToolUrl)', () => {
  test('https의 공개 도메인만 받는다', () => {
    assert.equal(
      ExternalToolUrl.check(' https://mcp.example.com/sse '),
      'https://mcp.example.com/sse',
    );
    for (const url of [
      'http://mcp.example.com',
      'ftp://mcp.example.com',
      'https://localhost:3000',
      'https://127.0.0.1/mcp',
      'https://[::1]/mcp',
      'https://intranet/mcp',
      'https://printer.local/mcp',
      'https://svc.internal/mcp',
      'https://user:pw@mcp.example.com',
      'not a url',
    ])
      assert.throws(() => ExternalToolUrl.check(url), RuleViolation, url);
  });
});

describe('ExternalTool', () => {
  test('관리자가 더하면 바로 켜지고, 이름은 러너의 MCP 서버 이름 규칙을 따른다', () => {
    const tool = ExternalTool.open('space', 'notion', fields, NOW);
    assert.equal(tool.ready(NOW), true);
    for (const name of ['N', 'notion_x', '1notion', 'a', 'x'.repeat(31)])
      assert.throws(() => ExternalTool.open('space', name, fields, NOW), RuleViolation, name);
  });

  test('머리글이 있으면 토큰을 넣어야 붙는다. 머리글을 비우면 토큰도 지운다', () => {
    const tool = ExternalTool.open(
      'space',
      'notion',
      { ...fields, header_name: 'Authorization' },
      NOW,
    );
    assert.equal(tool.ready(NOW), false, '토큰 필요');
    tool.setSecret(box.seal('Bearer abc'), NOW);
    assert.equal(tool.ready(NOW), true);
    assert.deepEqual(tool.jobView(box).toJSON().headers, { Authorization: 'Bearer abc' });
    tool.edit({ header_name: null }, NOW);
    assert.deepEqual(tool.jobView(box).toJSON().headers, {});
    assert.equal(tool.view().toJSON().hasSecret, false);
    assert.throws(() => tool.setSecret(box.seal('x'), NOW), RuleViolation, '머리글 먼저');
    assert.throws(() => ExternalTool.secretOf('a\nb'), RuleViolation, '한 줄만');
  });

  test('요청의 모양을 바꾸는 머리글에는 토큰을 싣지 않는다', () => {
    for (const header of ['Host', 'content-length', 'Bad Header'])
      assert.throws(
        () => ExternalTool.open('space', 'x-tool', { ...fields, header_name: header }, NOW),
        RuleViolation,
        header,
      );
  });

  test('화면에는 토큰이 없고 있는지만 보인다', () => {
    const tool = ExternalTool.open('space', 'notion', { ...fields, header_name: 'X-Key' }, NOW);
    tool.setSecret(box.seal('secret-value'), NOW);
    const shown = JSON.stringify(tool.view().toJSON());
    assert.equal(shown.includes('secret-value'), false);
    assert.equal(tool.view().toJSON().hasSecret, true);
  });

  test('제안은 결재로만 켠다: 끄기 · 켜기는 막고, 승인하면 켜고 제안한 에이전트에 붙인다', () => {
    const tool = ExternalTool.propose('space', 'agent-1', 'linear', fields, NOW);
    assert.equal(tool.ready(NOW), false);
    assert.throws(() => tool.switchTo(true, NOW), RuleViolation);
    const agent = agentWith(['read_public']);
    const done = tool.plugApproved('approval-1', null, agent, NOW);
    assert.deepEqual([done.data.outcome, done.data.approvalId], ['done', 'approval-1']);
    assert.equal(tool.ready(NOW), true);
    assert.deepEqual(agent.externalTools, ['linear']);
    const again = tool.plugApproved('approval-2', null, agent, NOW);
    assert.equal(again.data.outcome, 'failed', '이미 정한 제안');
  });

  test('결재 뒤 바뀐 제안 · 비공개를 읽게 된 에이전트에는 붙이지 않는다 (실패 결과)', () => {
    const stale = ExternalTool.propose('space', 'agent-1', 'linear', fields, NOW);
    assert.equal(
      stale.plugApproved('a', 99, agentWith(['read_public']), NOW).data.outcome,
      'failed',
    );
    const tool = ExternalTool.propose('space', 'agent-1', 'linear', fields, NOW);
    const privateAgent = agentWith(['read_all']);
    const result = tool.plugApproved('a', null, privateAgent, NOW);
    assert.equal(result.data.outcome, 'failed');
    assert.deepEqual(privateAgent.externalTools, []);
    assert.equal(tool.proposed, true, '그대로 제안');
  });
});

describe('에이전트의 외부 도구 칸', () => {
  test('비공개를 읽거나 셸이 있는 권한과 함께 두지 않는다: 도구를 붙일 때도, 권한을 바꿀 때도', () => {
    for (const scope of ['read_all', 'write', 'code', 'make'])
      assert.throws(() => agentWith([scope]).edit({ external_tools: ['notion'] }), RuleViolation);
    assert.throws(
      () => agentWith(['read_public'], ['notion']).edit({ scopes: ['read_all'] }),
      RuleViolation,
    );
    const agent = agentWith(['read_public', 'browse'], ['notion']);
    agent.edit({ external_tools: ['notion', 'notion', 'linear'] });
    assert.deepEqual(agent.externalTools, ['notion', 'linear'], '겹친 이름은 하나로');
  });

  test('열 개까지', () => {
    const names = Array.from({ length: 11 }, (_, i) => `tool-${i}`);
    assert.throws(() => agentWith(['read_public']).edit({ external_tools: names }), RuleViolation);
  });

  test('도구를 지우면 뺀다', () => {
    const agent = agentWith(['read_public'], ['notion', 'linear']);
    agent.unplugTool('notion');
    assert.deepEqual(agent.externalTools, ['linear']);
  });
});
