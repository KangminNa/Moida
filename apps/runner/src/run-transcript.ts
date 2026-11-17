import { RunEvent } from './progress';

// 에이전트 실행 한 번의 원문 (작업 세션, 기획서 결정 2026-11-17): 지시 · AI 말 · 부른 도구 이름과 짧은 입력 · 오류.
// 도구의 결과는 남기지 않는다 (읽은 파일 · 페이지의 글이 원문에 쌓이지 않게). 스트림(ClaudeStream · CodexStream)이
// 읽으면서 쌓고, 러너가 끝에 save_run_record로 보낸다. 서버가 비밀값을 지우고 개인정보를 마스킹한 뒤 쌓는다.
export class RunTranscript {
  /** 서버가 받는 원문의 길이 (AgentRunRecord.TRANSCRIPT_MAX). 넘으면 앞 · 뒤를 남기고 가운데를 줄인다 */
  static readonly MAX = 120_000;
  private static readonly HEAD = 40_000;
  private static readonly TAIL = 80_000;
  /** 도구 · 오류 한 줄의 길이 */
  private static readonly LINE = 300;
  /** 러너가 대신 쓰는 인수인계 메모의 마지막 답 길이 */
  private static readonly MEMO_ANSWER = 2_000;
  private static readonly MEMO_TOOLS = 20;

  private readonly lines: string[] = [];
  /** 부른 도구 (중복 없이, 처음 부른 순서) */
  private readonly tools = new Set<string>();

  /** AI의 말 한 덩이 */
  said(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.lines.push(`AI: ${trimmed}`);
  }

  /** 스트림이 만든 실행 기록: 도구는 이름과 대상, 오류는 그 글. 결과(마지막 답)는 said로 이미 남았다 */
  did(events: readonly RunEvent[]): void {
    for (const event of events) {
      const body = event.body.trim().slice(0, RunTranscript.LINE);
      if (!body) continue;
      if (event.kind === RunEvent.ERROR) this.lines.push(`! 오류: ${body}`);
      else if (event.kind !== RunEvent.RESULT) {
        this.lines.push(`- 도구: ${body}`);
        this.tools.add(body.split(' ')[0] ?? body);
      }
    }
  }

  /** 보낼 원문: 지시와 진행. 길면 앞 4만 · 뒤 8만 자를 남기고 가운데를 줄였다고 적는다 */
  text(instruction: string): string {
    const full = `[지시]\n${instruction.trim()}\n\n[진행]\n${this.lines.join('\n')}`;
    if (full.length <= RunTranscript.MAX) return full;
    const cut = full.length - RunTranscript.HEAD - RunTranscript.TAIL;
    return `${full.slice(0, RunTranscript.HEAD)}\n\n[… 가운데 ${cut}자 줄임 …]\n\n${full.slice(-RunTranscript.TAIL)}`;
  }

  /**
   * AI가 인수인계 메모를 쓰지 못했을 때 러너가 AI 없이 만드는 메모: 끝난 까닭 · 마지막 답의 앞부분 · 부른 도구.
   * 다음 실행이 무엇까지 했는지 짐작할 수 있을 만큼만
   */
  fallbackMemo(finalText: string, ending: string): string {
    const answer = finalText.trim().slice(0, RunTranscript.MEMO_ANSWER);
    const tools = [...this.tools].slice(0, RunTranscript.MEMO_TOOLS);
    return [
      `(AI가 메모를 쓰지 않아 러너가 남겼어요) 끝: ${ending}`,
      answer ? `마지막 답:\n${answer}` : '마지막 답: 없음',
      tools.length > 0 ? `부른 도구: ${tools.join(', ')}` : '부른 도구: 없음',
    ].join('\n\n');
  }
}
