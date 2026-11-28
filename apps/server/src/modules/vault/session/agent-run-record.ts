import {
  BaseEntity,
  RuleViolation,
  type RunRecordTarget,
  type SensitivePolicy,
} from '../../platform';
import type { RunMemoNew, RunMemoRow, RunMemoWrittenBy } from '../vault.tables';
import { SessionNote } from './session-note';
import { SessionTranscript } from './session-transcript';

// 에이전트 실행 한 번의 기록 (작업 세션, 기획서 결정 2026-11-17). 러너가 CLI가 끝난 뒤 save_run_record로 보낸다:
// 원문(지시 · AI 답 · 도구 이름과 짧은 입력, 도구 결과는 뺌)과 인수인계 메모. 작업 세션의 원문 한 줄은
// 머리(몇 번째 실행 · 에이전트 · 작업 · 세션 키) + 원문 + 메모다: 보관 형식에 원문만 나가도 메모가 남는다.
// 비밀값을 지우고 개인정보를 마스킹한 뒤에 쌓는다 (개인정보 마스킹은 에이전트 기록에만, 판은 고칠 수 없다).
// 작업 세션의 노트는 AI를 따로 돌리지 않고 최근 메모를 이어 붙여 만든다 (note).
export class AgentRunRecord {
  static readonly MEMO_MAX = 4_000;
  /** 러너가 보내는 원문의 길이 (길면 러너가 앞 4만 · 뒤 8만을 남기고 가운데를 줄인다) */
  static readonly TRANSCRIPT_MAX = 120_000;
  /** 노트에 이어 붙이는 최근 메모 수 (이번 메모 포함) */
  static readonly NOTE_MEMOS = 20;
  /** run_memos가 돌려주는 같은 세션 키의 최근 메모 수 */
  static readonly LINEAGE_MEMOS = 5;
  /** 작업 세션 노트의 태그 */
  private static readonly TAG = 'moida-agent';
  private static readonly UNTITLED = '에이전트 작업';

  private constructor(
    readonly target: RunRecordTarget,
    readonly transcript: SessionTranscript,
    private readonly memo: string,
    private readonly memoBy: RunMemoWrittenBy,
    private readonly flowTitle: string,
    private readonly taskTitle: string,
  ) {}

  /** 러너가 보낸 원문 · 메모에서. 비밀값을 지우고 개인정보를 마스킹한다. 메모가 비면 RuleViolation */
  static of(
    target: RunRecordTarget,
    text: string,
    memo: string,
    memoBy: RunMemoWrittenBy,
    resumed: boolean,
    policy: SensitivePolicy,
  ): AgentRunRecord {
    const mask = (section: string, value: string) => policy.scrub(section, value.trim(), true)[0];
    const cleanMemo = mask('memo', memo).slice(0, AgentRunRecord.MEMO_MAX);
    if (!cleanMemo) throw new RuleViolation('인수인계 메모가 비어 있어요');
    const taskTitle = mask('title', target.taskTitle).slice(0, SessionNote.TITLE_MAX) || '작업';
    const by = target.tool ? `${target.agentName} (${target.tool})` : target.agentName;
    const head = [
      `# ${target.runSeq}번째 실행 · ${by}${resumed ? ' · 이어서' : ''}`,
      `작업: ${taskTitle}`,
      `세션 키: ${target.lineage}`,
    ].join('\n');
    // 원문에는 메모를 지우기 전 그대로 넣고 한 번에 지운다: 무엇을 지웠는지(warnings)에 메모의 것도 남게
    const full = `${head}\n\n${text.trim()}\n\n## 인수인계 메모\n\n${memo.trim()}`;
    return new AgentRunRecord(
      target,
      SessionTranscript.scrubbed(full, policy, true),
      cleanMemo,
      memoBy,
      mask('title', target.flowTitle).slice(0, SessionNote.TITLE_MAX) || AgentRunRecord.UNTITLED,
      taskTitle,
    );
  }

  /** 인수인계 메모 한 줄 (vault.run_memos, 추가만). seq는 이 실행의 원문 번호 */
  memoRow(spaceId: string, sessionId: string, seq: number, now: Date): RunMemoNew {
    const t = this.target;
    return {
      id: BaseEntity.newId(),
      space_id: spaceId,
      session_id: sessionId,
      transcript_seq: seq,
      lineage: t.lineage,
      task_id: t.taskId,
      run_seq: t.runSeq,
      agent_id: t.agentId,
      agent_name: t.agentName.slice(0, 80) || '에이전트',
      task_title: this.taskTitle,
      memo: this.memo,
      written_by: this.memoBy,
      created_at: now,
    };
  }

  /**
   * 작업 세션의 노트 (AI 없음): 제목은 작업 세션의 제목, 한 일 칸에 메모를 오래된 것부터 이어 붙인다.
   * memos는 새것부터 (이번 메모가 맨 앞). 칸 한도를 넘으면 오래된 메모부터 뺀다
   */
  note(
    memos: readonly Pick<RunMemoRow, 'run_seq' | 'agent_name' | 'task_title' | 'memo'>[],
  ): SessionNote {
    const parts: string[] = [];
    let size = 0;
    for (const m of memos.slice(0, AgentRunRecord.NOTE_MEMOS)) {
      const part = `### ${m.task_title} · ${m.agent_name} (${m.run_seq}번째 실행)\n\n${m.memo}`;
      size += part.length + 2;
      if (size > SessionNote.SECTION_MAX) break;
      parts.unshift(part);
    }
    return SessionNote.write(
      this.flowTitle,
      [AgentRunRecord.TAG],
      new Map([['did', parts.join('\n\n')]]),
    );
  }
}
