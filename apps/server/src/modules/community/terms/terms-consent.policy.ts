import { Conflict } from '../../platform';
import type { TermKind } from '../community.tables';
import type { Agreement } from '../member/member.input';

// 약관 동의 확인 (가입 · 앱 참여, 2026-11-26): 화면이 읽고 동의한 버전이 지금 공개된 버전인가.
// 공통 약관(스토어)은 계정이 한 번 동의하고(옮겨 온 옛 계정은 첫 참여 때), 앱의 약관은 그 앱이 공개했을 때만 그 앱에 참여할 때 동의한다.
// 화면을 연 뒤 새 버전이 올라왔으면 409로 다시 읽고 동의하게 한다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class TermsConsent {
  private static readonly CHANGED = '약관이 바뀌었어요. 다시 읽고 동의해 주세요';

  /** 공통 약관이 둘 다 공개됐는가 (가입 · 코드 보내기 전에). 아니면 409 */
  static assertOpen(store: ReadonlyMap<TermKind, number | null>): void {
    if (store.get('terms') == null || store.get('privacy') == null)
      throw new Conflict('아직 약관이 공개되지 않아 가입할 수 없어요');
  }

  /**
   * 동의한 버전 확인. needStore: 이번에 공통 약관에도 동의하는가 (가입 · 아직 동의하지 않은 계정의 참여).
   * 앱의 약관은 공개된 것만 같아야 하고, 공개되지 않은 것은 null이어야 한다
   */
  static check(
    store: ReadonlyMap<TermKind, number | null>,
    app: ReadonlyMap<TermKind, number | null>,
    agreed: Agreement,
    needStore: boolean,
  ): void {
    if (needStore) {
      TermsConsent.assertOpen(store);
      if (
        agreed.termsVersion !== store.get('terms') ||
        agreed.privacyVersion !== store.get('privacy')
      )
        throw new Conflict(TermsConsent.CHANGED);
    }
    if (
      agreed.appTermsVersion !== (app.get('terms') ?? null) ||
      agreed.appPrivacyVersion !== (app.get('privacy') ?? null)
    )
      throw new Conflict(TermsConsent.CHANGED);
  }
}
