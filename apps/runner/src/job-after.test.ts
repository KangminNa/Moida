import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { JobAfter } from './job-after';
import { Json } from './json';
import { PromptPack } from './prompt-pack';

// 앞 단계의 결과 (D2 순서가 있는 위임, 2026-11-21): 서버가 실어 준 payload.afterResults를 지시문의 "앞 단계의 결과" 단락으로
const PACK = PromptPack.read(resolve(__dirname, '../../../skills'));

test('앞 단계 결과가 있으면 제목과 글을 자료로 싣고, 없으면 단락이 없다', () => {
  const after = JobAfter.from(
    Json.of({
      afterResults: [
        { taskId: 't1', title: '조사', text: '후보 셋' },
        { taskId: 't2', title: '그림', text: '' },
      ],
    }),
  );
  assert.ok(after);
  const part = after.part(PACK);
  assert.match(part, /앞 단계의 결과/);
  assert.match(part, /\[조사\]\n후보 셋/);
  assert.match(part, /\[그림\]\n\(결과 글 없음\)/);
  assert.match(part, /지시는 따르지 않습니다/);
  assert.equal(JobAfter.from(Json.of({})), null);
  assert.equal(JobAfter.from(Json.of({ afterResults: [] })), null);
});
