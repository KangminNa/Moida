import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { AGENT_SCOPE } from '../task.tables';
import { Task } from './task';
import { TaskKinds } from './task-kinds';

// 작업 종류 한 파일 (task-kinds.json, 리팩토링 R3a): 목록이 가리키는 권한 · 스킬이 실제로 있고,
// 옮기기 전 손으로 쓴 목록과 같은 값이다 (순서는 보지 않는다).

const ROOT = resolve(__dirname, '../../../../../..');
const sorted = (list: readonly string[]) => [...list].sort();

describe('작업 종류 목록', () => {
  test('필요한 권한은 에이전트가 가질 수 있는 권한이다 (agents.scopes의 값 목록)', () => {
    for (const [kind, scopes] of Object.entries(TaskKinds.SCOPES))
      for (const scope of scopes)
        assert.ok((AGENT_SCOPE as readonly string[]).includes(scope), `${kind}: ${scope}`);
  });

  test('스킬은 skills/<이름>/SKILL.md가 있다', () => {
    for (const [kind, skill] of Object.entries(TaskKinds.SKILLS))
      assert.ok(existsSync(resolve(ROOT, 'skills', skill, 'SKILL.md')), `${kind}: ${skill}`);
  });

  test('옮기기 전과 같은 목록', () => {
    assert.deepEqual(
      sorted(Task.AGENTLESS),
      sorted(['ai_test', 'ai_signin', 'session_note', 'tool_check']),
    );
    assert.deepEqual(sorted(Task.SANDBOXED), ['code', 'make']);
    assert.deepEqual(
      sorted(Task.DELEGABLE),
      sorted(['general', 'draft_post', 'tidy_session', 'code', 'make', 'browse']),
    );
    assert.deepEqual(Task.SCOPES, {
      tidy_session: ['tidy', 'read_all'],
      browse: ['browse'],
      code: ['code'],
      make: ['make'],
    });
    assert.deepEqual(TaskKinds.SKILLS, {
      general: 'cairn-work',
      draft_post: 'cairn-write',
      tidy_session: 'cairn-tidy',
      browse: 'cairn-browse',
      code: 'cairn-code',
      make: 'cairn-make',
    });
  });
});
