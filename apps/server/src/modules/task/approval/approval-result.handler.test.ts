import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { ApprovalResultHandler } from './approval-result.handler';

// 결재 결과를 받는 주제 목록이 이벤트 목록과 같은가: 결과를 담는 주제(approvalId · outcome 칸)를 새로 만들고
// ApprovalResultHandler.TOPICS에 더하지 않으면 결재를 올린 작업이 끝나지 않는다. 그 실수를 여기서 잡는다.

test('결과를 담는 주제는 이벤트 목록에서 approvalId · outcome 칸을 가진 주제와 같다 (+ 기능 패키지 plugin.*)', () => {
  const modules = resolve(__dirname, '../..');
  const carrying: string[] = [];
  for (const m of readdirSync(modules)) {
    const file = join(modules, m, `${m}.events.json`);
    if (!existsSync(file)) continue;
    const topics = JSON.parse(readFileSync(file, 'utf8')).topics as Record<
      string,
      { fields: string[] }
    >;
    for (const [topic, { fields }] of Object.entries(topics)) {
      const names = fields.map((f) => f.replace(/\?$/, ''));
      if (names.includes('approvalId') && names.includes('outcome')) carrying.push(topic);
    }
  }
  assert.ok(carrying.length >= 10, '이벤트 목록을 읽지 못했어요');
  assert.deepEqual(
    [...ApprovalResultHandler.TOPICS].sort(),
    [...carrying, 'plugin.*'].sort(),
    'ApprovalResultHandler.TOPICS에 더하거나 빼 주세요',
  );
});
