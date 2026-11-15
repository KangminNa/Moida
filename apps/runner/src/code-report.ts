import type { CodeSpec } from './code-spec';
import type { StageCheck } from './stage-check';

// 코드 작업의 결과 글: 결과(submit_result)의 text, PR 본문, 머지 결재의 메모 (4단계).
// 검사는 마지막 검사다 (검증 고리 V: 떨어져 AI가 한 번 더 고쳤으면 그 뒤의 검사).
export class CodeReport {
  /** 결과에 싣는 출력의 끝부분 */
  private static readonly TAIL_MAX = 2_000;
  /** 파일 목록에서 보이는 수 */
  static readonly FILES_SHOWN = 30;

  constructor(
    private readonly spec: CodeSpec,
    /** 기준 커밋 */
    private readonly baseSha: string,
    /** 올린 커밋 */
    private readonly head: string,
    private readonly files: readonly string[],
    readonly checks: readonly StageCheck[],
    /** AI의 마지막 답 */
    private readonly summary: string,
  ) {}

  /** 결과 글 (PR 본문의 재료) */
  text(): string {
    const { spec, checks } = this;
    const lines = [
      `${spec.branch} 브랜치에 올렸어요 (${this.head.slice(0, 7)}, 파일 ${this.files.length}개)`,
      `기준: ${spec.base} (${this.baseSha.slice(0, 7)})`,
      '',
      '바꾼 파일:',
      ...CodeReport.list(this.files).map((f) => `- ${f}`),
    ];
    if (checks.length > 0) {
      const retried = checks.some((c) => c.retried);
      lines.push('', retried ? '검사 (떨어져 AI가 한 번 더 고친 뒤):' : '검사:');
      lines.push(...checks.map((c) => `- ${c.name}: ${c.how}`));
      for (const failed of checks.filter((c) => !c.ok))
        lines.push('', `--- ${failed.name}의 끝부분 ---`, CodeReport.tail(failed.tail));
    }
    lines.push('', '요약:', this.summary || '(요약 없음)');
    return lines.join('\n');
  }

  /** 머지 결재의 메모 */
  approvalNote(url: string): string {
    const failed = this.checks.filter((c) => !c.ok).map((c) => c.name);
    const checked =
      this.checks.length === 0
        ? '검사 명령 없음'
        : failed.length === 0
          ? `검사 ${this.checks.length}개 통과`
          : `실패한 검사: ${failed.join(', ')}`;
    return [`PR: ${url}`, checked, 'GitHub에서 리뷰 · 머지한 뒤 승인해 주세요.'].join('\n');
  }

  /** 보이는 만큼의 파일과 나머지 수 */
  static list(files: readonly string[]): readonly string[] {
    const shown = files.slice(0, CodeReport.FILES_SHOWN);
    const rest = files.length - shown.length;
    return rest > 0 ? [...shown, `외 ${rest}개`] : shown;
  }

  /** 출력의 끝부분 (setup · 검사) */
  static tail(output: string): string {
    return output.slice(-CodeReport.TAIL_MAX) || '(출력 없음)';
  }
}
