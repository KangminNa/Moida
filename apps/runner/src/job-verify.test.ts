import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { JobVerify } from './job-verify';
import { Json } from './json';
import { PromptPack } from './prompt-pack';

// 검증 루프 (L2, 2026-11-27): 서버가 실은 check · fixNote를 지시문 단락으로
const PACK = PromptPack.read(resolve(__dirname, '../../../skills'));

test('검증 일은 맡긴 일 · 받을 것 · 결과와 판정 JSON 모양을, 고치기 일은 앞 결과 · 고칠 것을 싣는다', () => {
  const check = JobVerify.from(
    Json.of({
      verifyOf: 't1',
      check: { title: '조사', instruction: '후보 셋', deliver: '표로', result: '가 · 나 · 다' },
    }),
  );
  assert.ok(check);
  const part = check.part(PACK);
  assert.match(part, /하위 작업 검증/);
  assert.match(part, /후보 셋/);
  assert.match(part, /표로/);
  assert.match(part, /가 · 나 · 다/);
  assert.match(part, /"verdict"/);

  const fix = JobVerify.from(
    Json.of({ fixNote: { previous: '가 · 나', summary: '출처 없음', fixes: ['출처를 단다'] } }),
  );
  assert.ok(fix);
  const fixPart = fix.part(PACK);
  assert.match(fixPart, /검증에서 나온 고칠 것/);
  assert.match(fixPart, /- 출처를 단다/);
  assert.match(fixPart, /가 · 나/);

  assert.equal(JobVerify.from(Json.of({})), null);
  assert.equal(JobVerify.from(Json.of({ check: {} })), null, 'verifyOf 없는 check는 아니다');
});
