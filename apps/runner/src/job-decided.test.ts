import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { JobDecided } from './job-decided';
import { Json } from './json';
import { PromptPack } from './prompt-pack';

// 확인 필요 판단의 답 (L3, 2026-11-28): 서버가 실은 decided를 지시문 단락으로
const PACK = PromptPack.read(resolve(__dirname, '../../../skills'));

test('고른 안 · 기한이 지나 정해진 안 · 고쳐 말한 것을 각각 싣고, 답이 없는 일에는 단락이 없다', () => {
  const picked = JobDecided.from(
    Json.of({ decided: { text: '날짜', chosen: '토', picked: '일', note: null, lapsed: false } }),
  );
  assert.ok(picked);
  const part = picked.part(PACK);
  assert.match(part, /확인 필요 판단의 답/);
  assert.match(part, /판단: 날짜/);
  assert.match(part, /고른 안: 일/);
  assert.equal(part.includes('기한 안에 답이 없어'), false);

  const lapsed = JobDecided.from(
    Json.of({ decided: { text: '날짜', chosen: '토', picked: '토', note: null, lapsed: true } }),
  );
  assert.match(lapsed?.part(PACK) ?? '', /기한 안에 답이 없어/);

  const changed = JobDecided.from(
    Json.of({
      decided: { text: '날짜', chosen: '토', picked: null, note: '다음 주로', lapsed: false },
    }),
  );
  const changedPart = changed?.part(PACK) ?? '';
  assert.match(changedPart, /다르게 하라고 했다/);
  assert.match(changedPart, /다음 주로/);
  assert.equal(changedPart.includes('고른 안:'), false);

  assert.equal(JobDecided.from(Json.of({})), null);
});
