import { BaseEntity, RuleViolation, TableEntity } from '../../platform';
import type { TermByKind, TermKind, TermNew, TermRow } from '../community.tables';
import { TermView } from './terms.view';

// 앱의 약관 한 버전 (community.terms, 스토어 3-4): 이용약관(terms) · 개인정보처리방침(privacy). 추가만 한다:
// 지난 버전에 동의한 회원이 있어 고치지 않고 새 버전을 쌓는다. 공개된 것은 늘 마지막 버전이다.
// 쓰는 사람은 관리자뿐이다 (콘솔에서 바로 · AI 제안을 승인해서): 회원에게 보이는 약속이라 AI가 바로 바꾸지 않는다 (원칙 7)
export class Term extends TableEntity<TermRow, TermNew> {
  static readonly MAX = 50_000;

  /**
   * 새 버전: 본 버전(before, 처음이면 0)의 다음 번호. 같은 번호가 이미 있으면 DB가 막는다 (그사이 다른 버전이 올라옴, 409).
   * 본문은 마크다운, 앞뒤 공백을 빼고 1~MAX자
   */
  static publish(
    appId: string,
    kind: TermKind,
    before: number,
    body: string,
    by: TermByKind,
    byId: string | null,
    now: Date,
  ): Term {
    const clean = body.trim();
    if (clean.length === 0 || clean.length > Term.MAX)
      throw new RuleViolation(`약관은 1~${Term.MAX.toLocaleString('ko-KR')}자예요`);
    return new Term(
      {
        id: BaseEntity.newId(),
        app_id: appId,
        kind,
        version: before + 1,
        body: clean,
        by_kind: by,
        by_id: byId,
        created_at: now,
      },
      true,
    );
  }

  static restore(row: TermRow): Term {
    return new Term(row);
  }

  override get version(): number {
    return this.row.version;
  }

  /** 설정 바꾸기 terms의 지금 값 (TermsQuery.settingNow와 같은 모양): 승인 뒤 낡음 확인에 쓴다 */
  settingValues(): Record<string, unknown> {
    return { app_id: this.row.app_id, kind: this.row.kind, body: this.row.body };
  }

  view(): TermView {
    return new TermView(this.row);
  }
}
