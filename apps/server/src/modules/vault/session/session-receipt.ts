import { Redaction } from '../../platform';
import { SessionSavedView, TranscriptSavedView } from './session.view';

/**
 * 세션 저장 한 번의 결과. 같은 request_id가 다시 오면 이 기록(platform.idempotency)을 되살려 그대로 돌려준다.
 *   saved      새 판이 쌓였다
 *   unchanged  이미 있는 판과 내용이 같아 판을 만들지 않았다
 *   duplicate  같은 요청이 다시 왔다 (처음 결과 그대로)
 */
export class SessionReceipt {
  static readonly SAVED = 'saved';
  static readonly UNCHANGED = 'unchanged';
  static readonly DUPLICATE = 'duplicate';
  /** 쌓지 않았다: 모으지 않는 프로젝트의 원문, 더 새 원문의 노트가 이미 있는 옛 노트 */
  static readonly SKIPPED = 'skipped';

  private constructor(
    readonly status: string,
    /** 쌓지 않은 원문(모으지 않는 프로젝트)은 세션이 없다 */
    readonly sessionId: string | null,
    readonly seq: number,
    readonly warnings: readonly Redaction[],
  ) {}

  static skipped(sessionId: string | null, seq: number): SessionReceipt {
    return new SessionReceipt(SessionReceipt.SKIPPED, sessionId, seq, []);
  }

  static saved(sessionId: string, seq: number, warnings: readonly Redaction[]): SessionReceipt {
    return new SessionReceipt(SessionReceipt.SAVED, sessionId, seq, warnings);
  }

  static unchanged(sessionId: string, seq: number, warnings: readonly Redaction[]): SessionReceipt {
    return new SessionReceipt(SessionReceipt.UNCHANGED, sessionId, seq, warnings);
  }

  /** 남겨 둔 결과(toJSON)에서. 상태는 duplicate */
  static replay(stored: Readonly<Record<string, unknown>>): SessionReceipt {
    const warnings = Array.isArray(stored.warnings) ? stored.warnings : [];
    return new SessionReceipt(
      SessionReceipt.DUPLICATE,
      stored.sessionId === null ? null : String(stored.sessionId),
      Number(stored.seq),
      warnings.map((w) => Redaction.restore(w as Record<string, unknown>)),
    );
  }

  toJSON(): object {
    return {
      status: this.status,
      sessionId: this.sessionId,
      seq: this.seq,
      warnings: this.warnings,
    };
  }

  /** save_session의 답 (AI에게). site는 블로그의 사이트 주소 */
  view(site: string): SessionSavedView {
    return new SessionSavedView(this.status, this.sessionId ?? '', this.seq, this.warnings, site);
  }

  /** save_transcript · save_note의 답. seq는 원문의 번호, 노트면 판의 번호 */
  transcriptView(): TranscriptSavedView {
    return new TranscriptSavedView(this.status, this.sessionId, this.seq, this.warnings);
  }
}
