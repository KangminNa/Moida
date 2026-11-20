import type { ChatReviewVerdict } from './chat.view';

// 검토자 짝의 판정 (검증 고리 V, 기획서 결정 2026-11-16). 상태 없음.
// 검토자는 지시문 틀 result-review대로 JSON 한 줄로 답한다: 판정(pass · fix · reject) · 까닭 · 완료 조건 체크리스트 · 고칠 것 · 고르지 말 것.
// 답은 AI가 쓴 글이라 모양을 믿지 않는다: JSON이 아니거나 판정이 모르는 값이면 unknown으로 보고 글을 그대로 보인다
// (자동 고치기는 하지 않는다). 콘솔에서 고친 옛 틀(글로 답함)도 그래서 지금처럼 동작한다.
// 점수로 판정 (2026-11-20, ECC의 평가자 점수): 완료 조건마다 1~5점. 점수가 있으면 4점 이상만 채운 조건이고,
// 4점 아래 조건이 있는데 통과라고 하면 서버가 고칠 것으로 바꾼다 (평가자가 후하게 주는 경향을 판정 글이 아니라 규칙으로 막는다)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 결과 결재의 서비스 · 읽기가 함께 쓴다
export class ChatReview {
  static readonly PASS = 'pass';
  static readonly FIX = 'fix';
  static readonly REJECT = 'reject';
  static readonly UNKNOWN = 'unknown';
  /** 검토가 "고칠 것 있음"이면 같은 상대에게 다시 맡기는 회차 수 (넘으면 그 판정 그대로 카드에) */
  static readonly FIX_MAX = 1;
  private static readonly VERDICTS: readonly string[] = [
    ChatReview.PASS,
    ChatReview.FIX,
    ChatReview.REJECT,
  ];
  /** 체크리스트 · 고칠 것 · 고르지 말 것의 줄 수와 한 줄 길이 */
  private static readonly LINES_MAX = 10;
  private static readonly LINE_MAX = 300;
  private static readonly SUMMARY_MAX = 1_000;
  /** 판정을 읽지 못했을 때 보일 글의 길이 */
  private static readonly RAW_MAX = 4_000;
  /** 통과에 필요한 조건마다의 점수 (1~5점) */
  static readonly PASS_SCORE = 4;

  /** 검토의 답(작업의 result.text)을 읽는다 */
  static parse(text: string): ChatReviewVerdict {
    const json = ChatReview.jsonOf(text);
    const verdict = typeof json?.verdict === 'string' ? json.verdict.trim().toLowerCase() : '';
    if (!json || !ChatReview.VERDICTS.includes(verdict))
      return {
        verdict: ChatReview.UNKNOWN,
        summary: text.trim().slice(0, ChatReview.RAW_MAX),
        checklist: [],
        fixes: [],
        skip: [],
        score: null,
      };
    const checklist = ChatReview.listOf(json.checklist)
      .map((line) => {
        const row = (line ?? {}) as {
          item?: unknown;
          ok?: unknown;
          note?: unknown;
          score?: unknown;
        };
        const score = ChatReview.scoreOf(row.score);
        return {
          item: ChatReview.cut(row.item, ChatReview.LINE_MAX),
          ok: score === null ? row.ok === true : score >= ChatReview.PASS_SCORE,
          note: ChatReview.cut(row.note, ChatReview.LINE_MAX),
          score,
        };
      })
      .filter((line) => line.item !== '');
    const scores = checklist.flatMap((line) => (line.score === null ? [] : [line.score]));
    const review: ChatReviewVerdict = {
      verdict: verdict as ChatReviewVerdict['verdict'],
      summary: ChatReview.cut(json.summary, ChatReview.SUMMARY_MAX),
      checklist,
      fixes: ChatReview.textsOf(json.fixes),
      skip: ChatReview.textsOf(json.skip),
      score:
        scores.length > 0
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
          : null,
    };
    return ChatReview.gated(review);
  }

  /** 4점 아래 조건이 있는 통과는 고칠 것: 고칠 것을 적지 않았으면 낮은 조건과 그 까닭을 고칠 것으로 */
  private static gated(review: ChatReviewVerdict): ChatReviewVerdict {
    const low = ChatReview.lowOf(review);
    if (review.verdict !== ChatReview.PASS || low === null || low >= ChatReview.PASS_SCORE)
      return review;
    const unmet = review.checklist
      .filter((line) => !line.ok)
      .map((line) =>
        ChatReview.cut(`${line.item}${line.note ? `: ${line.note}` : ''}`, ChatReview.LINE_MAX),
      );
    const note = `${ChatReview.PASS_SCORE}점 아래 조건이 있어 고칠 것으로 봄`;
    return {
      ...review,
      verdict: ChatReview.FIX,
      summary: ChatReview.cut(
        review.summary ? `${review.summary} · ${note}` : note,
        ChatReview.SUMMARY_MAX,
      ),
      fixes: review.fixes.length > 0 ? review.fixes : unmet,
    };
  }

  /** 완료 조건 가운데 가장 낮은 점수 (점수가 없으면 null) */
  static lowOf(review: ChatReviewVerdict): number | null {
    const scores = review.checklist.flatMap((line) => (line.score === null ? [] : [line.score]));
    return scores.length > 0 ? Math.min(...scores) : null;
  }

  /** 조건 하나의 점수: 1~5의 정수 (소수는 반올림), 숫자가 아니면 null */
  private static scoreOf(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(5, Math.max(1, Math.round(value)));
  }

  /** 다시 맡겨 고칠 판정인가: 고칠 것이 적혀 있어야 한다 (무엇을 고칠지 모르면 사람에게) */
  static wantsFix(review: ChatReviewVerdict | null): boolean {
    return review?.verdict === ChatReview.FIX && review.fixes.length > 0;
  }

  /** 지시문 틀 result-fix의 자리 */
  static fixFields(review: ChatReviewVerdict): Record<string, string | null> {
    const unmet = review.checklist.filter((line) => !line.ok);
    const score = (line: ChatReviewVerdict['checklist'][number]) =>
      line.score === null ? '' : ` ${line.score}점`;
    return {
      summary: review.summary || null,
      fixes: review.fixes.map((fix) => `- ${fix}`).join('\n'),
      unmet:
        unmet.length > 0
          ? unmet
              .map((line) => `- ${line.item}${score(line)}${line.note ? ` (${line.note})` : ''}`)
              .join('\n')
          : null,
    };
  }

  /** 소식 한 줄: 판정과 까닭 (읽지 못했으면 글 그대로) */
  static line(review: ChatReviewVerdict): string {
    const label: Record<string, string> = {
      [ChatReview.PASS]: '그대로 승인',
      [ChatReview.FIX]: '고칠 것 있음',
      [ChatReview.REJECT]: '반려 권함',
    };
    const base = label[review.verdict];
    if (!base) return review.summary || '-';
    const head = review.score === null ? base : `${base} (평균 ${review.score}점)`;
    return review.summary ? `${head} · ${review.summary}` : head;
  }

  private static listOf(value: unknown): unknown[] {
    return Array.isArray(value) ? value.slice(0, ChatReview.LINES_MAX) : [];
  }

  private static textsOf(value: unknown): string[] {
    return ChatReview.listOf(value)
      .map((line) => ChatReview.cut(line, ChatReview.LINE_MAX))
      .filter((line) => line !== '');
  }

  /** 답 글 안의 JSON 객체 (앞뒤에 다른 글이 붙어도 첫 { 부터 마지막 } 까지) */
  private static jsonOf(text: string): Record<string, unknown> | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1));
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private static cut(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }
}
