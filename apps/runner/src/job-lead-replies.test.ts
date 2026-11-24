import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { JobLeadReplies } from './job-lead-replies';
import { Json } from './json';
import { PromptPack } from './prompt-pack';
import { SubtaskResult } from './subtask-result';

// 대표 ↔ 일꾼 대화 (2026-11-24): 일꾼에게는 "# 대표의 답", 깬 대표에게는 질문과 reply_worker 안내
const PACK = PromptPack.read(resolve(__dirname, '../../../skills'));

test('대표의 답이 있으면 물음과 답을 싣고, 없으면 단락이 없다', () => {
  const replies = JobLeadReplies.from(
    Json.of({ leadTalk: { asked: 1, question: null, replies: [{ q: '기간은?', a: '3년' }] } }),
  );
  assert.ok(replies);
  const part = replies.part(PACK);
  assert.match(part, /# 대표의 답/);
  assert.match(part, /- 물음: 기간은\?\n {2}답: 3년/);
  assert.equal(JobLeadReplies.from(Json.of({})), null);
  assert.equal(JobLeadReplies.from(Json.of({ leadTalk: { replies: [] } })), null);
});

test('일꾼이 물어 깬 대표는 "대표의 답 기다림"인 일의 질문과 reply_worker 안내를 받는다', () => {
  const asking = SubtaskResult.from(
    Json.of({
      task_id: 't1',
      title: '조사',
      agent: '일꾼 1',
      status: 'waiting',
      waiting: 'lead',
      summary: '기간을 1년으로 할까요, 3년으로 할까요?',
    }),
  );
  assert.equal(asking.open, '대표의 답 기다림');
  const part = SubtaskResult.part(PACK, [asking], 'question', 2);
  assert.match(part, /일꾼이 물어서 먼저 깨웠습니다/);
  assert.match(part, /reply_worker/);
  assert.match(part, /\[대표의 답 기다림 · \d+분째\] 조사/);
  assert.match(part, /기간을 1년으로 할까요/);
});
