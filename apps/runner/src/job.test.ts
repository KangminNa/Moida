import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { Job } from './job';

// 러너가 이름으로 알아보는 작업 종류는 서버의 작업 종류 목록(apps/server/src/modules/task/task-kinds.json)에 다 있다 (리팩토링 R3a).
// 러너는 서버 코드를 가져오지 않아서(MCP로만 이야기한다) 목록 파일을 글로 읽어 맞춰 본다.

test('러너가 아는 작업 종류는 서버의 작업 종류 목록에 있다', () => {
  const file = resolve(__dirname, '../../server/src/modules/task/task-kinds.json');
  const kinds = Object.keys(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>);
  for (const kind of Job.KINDS) assert.ok(kinds.includes(kind), kind);
});
