import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ToolFinder } from './tool-finder.policy';

// 도구 찾기의 판단 (2026-11-24): 레지스트리의 답(2025-09 이후 모양)에서 공식 · 제3자 · 로컬 실행용을 가른다.
// 아래 이름 · 주소는 레지스트리에서 실제로 본 모양을 본뜬 것이다 (서비스 도메인 아래의 남의 앱, 다른 회사가 대신 연 서버)

const answer = {
  servers: [
    {
      server: {
        name: 'app.example-gen.agentshop/marketplace',
        description: '남의 앱',
        remotes: [{ type: 'streamable-http', url: 'https://agentshop.example-gen.app/mcp' }],
      },
    },
    {
      server: {
        name: 'ai.hostco/notes',
        title: 'Notes (hosted)',
        remotes: [
          {
            type: 'streamable-http',
            url: 'https://server.hostco.ai/notes/mcp',
            headers: [{ name: 'Authorization', isRequired: true, isSecret: true }],
          },
        ],
      },
    },
    {
      server: {
        name: 'com.notes/mcp',
        title: 'Notes',
        remotes: [{ type: 'sse', url: 'https://mcp.notes.com/sse' }],
      },
    },
    { server: { name: 'io.github.someone/notes-local', packages: [{ registryType: 'npm' }] } },
    {
      server: {
        name: 'com.notes/bad',
        remotes: [{ type: 'streamable-http', url: 'http://mcp.notes.com' }],
      },
    },
  ],
};

describe('ToolFinder', () => {
  test('게시자 도메인과 주소가 모두 서비스 도메인 아래면 공식, 먼저 보인다', () => {
    const [first, ...rest] = ToolFinder.candidates(answer, 'notes.com');
    assert.deepEqual(
      [first?.name, first?.official, first?.url],
      ['com.notes/mcp', true, 'https://mcp.notes.com/sse'],
    );
    assert.ok(rest.every((c) => !c.official));
  });

  test('다른 회사가 대신 연 서버는 제3자, 키 머리글을 알려 준다', () => {
    const hosted = ToolFinder.candidates(answer, 'notes.com').find(
      (c) => c.name === 'ai.hostco/notes',
    );
    assert.deepEqual(
      [hosted?.official, hosted?.publisher, hosted?.headers],
      [false, 'hostco.ai', ['Authorization']],
    );
    assert.match(hosted?.why ?? '', /제3자/);
  });

  test('비슷한 도메인 · 로컬 실행용 · http 주소는 공식이 아니다', () => {
    const found = ToolFinder.candidates(answer, 'example-gen.ai');
    assert.ok(
      found.every((c) => !c.official),
      '다른 최상위 도메인(.app)의 남의 앱',
    );
    const local = found.find((c) => c.name.startsWith('io.github.'));
    assert.deepEqual([local?.url, local?.publisher], [null, 'GitHub someone']);
    assert.match(local?.why ?? '', /로컬 실행용/);
    assert.equal(found.find((c) => c.name === 'com.notes/bad')?.url, null);
  });

  test('도메인은 주소에서 호스트만, www.는 뗀다. 모양이 틀리면 거절', () => {
    assert.equal(ToolFinder.domainOf('https://www.Notes.com/docs'), 'notes.com');
    assert.equal(ToolFinder.domainOf(null), null);
    assert.throws(() => ToolFinder.domainOf('localhost'), /도메인을 적어요/);
  });

  test('모르는 모양의 답은 빈 목록', () => {
    assert.deepEqual(ToolFinder.candidates({ nope: 1 }, null), []);
    assert.deepEqual(ToolFinder.candidates(null, null), []);
  });
});
