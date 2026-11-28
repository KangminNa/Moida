import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation, RunRecordTarget, SensitivePolicy } from '../../platform';
import { AgentRunRecord } from './agent-run-record';
import { SessionNote } from './session-note';

// 에이전트 실행 한 번의 기록 (작업 세션, 기획서 결정 2026-11-17)

const policy = new SensitivePolicy();
const NOW = new Date('2026-11-17T10:00:00Z');
const target = new RunRecordTarget(
  'task-1',
  2,
  'chat:c1:agent-1',
  'chat:c1',
  '매일 아침 블로그 글',
  '오늘 주제 정리',
  'agent-1',
  '글쓰기',
  'claude',
);

describe('AgentRunRecord', () => {
  test('원문 한 줄은 머리 + 원문 + 메모. 비밀값을 지우고 개인정보를 마스킹한다', () => {
    const run = AgentRunRecord.of(
      target,
      `## 지시\n010-1234-5678로 연락\n## 도구\nBash: echo sk-ant-${'x'.repeat(30)}`,
      '한 일: 초안 셋. 남은 일: 사진. 연락처 me@example.com',
      'ai',
      true,
      policy,
    );
    const text = run.transcript.text;
    assert.match(
      text,
      /^# 2번째 실행 · 글쓰기 \(claude\) · 이어서\n작업: 오늘 주제 정리\n세션 키: chat:c1:agent-1/,
    );
    assert.match(text, /## 인수인계 메모\n\n한 일: 초안 셋/);
    for (const raw of ['010-1234-5678', 'me@example.com', 'sk-ant-'])
      assert.equal(text.includes(raw), false, raw);
    const labels = run.transcript.redactions.map((r) => r.label);
    assert.ok(
      labels.includes('전화번호') &&
        labels.includes('이메일') &&
        labels.includes('Anthropic API 키'),
    );

    const memo = run.memoRow('space', 'session', 3, NOW);
    assert.deepEqual(
      [memo.transcript_seq, memo.lineage, memo.run_seq, memo.written_by, memo.task_title],
      [3, 'chat:c1:agent-1', 2, 'ai', '오늘 주제 정리'],
    );
    assert.equal(memo.memo, '한 일: 초안 셋. 남은 일: 사진. 연락처 [지움: 이메일]');
  });

  test('메모가 비면 거절한다', () => {
    assert.throws(
      () => AgentRunRecord.of(target, '원문', '   ', 'runner', false, policy),
      RuleViolation,
    );
  });

  test('노트: 작업 세션의 제목, 메모를 오래된 것부터 이어 붙이고 칸 한도를 넘으면 오래된 것부터 뺀다', () => {
    const run = AgentRunRecord.of(target, '원문', '세 번째 메모', 'ai', false, policy);
    const memo = (seq: number, text: string) => ({
      run_seq: seq,
      agent_name: '글쓰기',
      task_title: '오늘 주제 정리',
      memo: text,
    });
    const note = run.note([memo(3, '세 번째 메모'), memo(2, '두 번째'), memo(1, '첫 번째')]);
    assert.equal(note.title, '매일 아침 블로그 글');
    assert.deepEqual(note.tags, ['moida-agent']);
    const did = note.section('did');
    assert.ok(did.indexOf('첫 번째') < did.indexOf('두 번째'));
    assert.ok(did.indexOf('두 번째') < did.indexOf('세 번째 메모'));
    assert.match(did, /### 오늘 주제 정리 · 글쓰기 \(1번째 실행\)/);

    const big = Array.from({ length: 8 }, (_, i) => memo(8 - i, `${i}`.repeat(3_900)));
    const trimmed = run.note(big).section('did');
    assert.ok(trimmed.length <= SessionNote.SECTION_MAX);
    assert.ok(trimmed.includes('0'.repeat(3_900)), '가장 새 메모는 남는다');
    assert.equal(trimmed.includes('7'.repeat(3_900)), false, '가장 오래된 메모부터 뺀다');
  });
});
