import { TermText } from './TermText';
import type { Term } from './types';

/** 가입 · 참여 화면이 읽은 약관 (없으면 null) */
export type AgreeTerms = {
  terms: Term | null;
  privacy: Term | null;
  appTerms: Term | null;
  appPrivacy: Term | null;
};

/**
 * 약관 동의 칸 (스토어 계정, 2026-11-26): 공통 약관(스토어, 가입할 때 한 번)과 이 앱이 공개한 약관을 이 화면에서 펼쳐 읽고
 * 한 번에 동의한다 (다른 화면으로 가면 쓰던 칸이 사라진다). store: 공통 약관에도 동의하는가 (가입 · 아직 동의하지 않은 계정)
 */
export function TermsAgree({
  terms,
  store,
  agreed,
  onChange,
}: {
  terms: AgreeTerms;
  store: boolean;
  agreed: boolean;
  onChange: (agreed: boolean) => void;
}) {
  const shown = [
    ...(store
      ? [
          ['이용약관', terms.terms],
          ['개인정보처리방침', terms.privacy],
        ]
      : []),
    ['이 앱의 이용약관', terms.appTerms],
    ['이 앱의 개인정보처리방침', terms.appPrivacy],
  ].filter((pair): pair is [string, Term] => pair[1] !== null);
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map(([label, term]) => (
        <details className="member-terms" key={label}>
          <summary>{label} 보기</summary>
          <TermText term={term} />
        </details>
      ))}
      <label className="member-check">
        <input type="checkbox" checked={agreed} onChange={(e) => onChange(e.target.checked)} />
        <span>위 약관에 동의해요</span>
      </label>
    </>
  );
}

/** 보낼 동의 버전: 동의하는 약관만 그 버전, 아니면 null (서버 TermsConsent가 지금 버전과 맞춰 본다) */
export function agreedVersions(terms: AgreeTerms, store: boolean) {
  return {
    termsVersion: store ? (terms.terms?.version ?? null) : null,
    privacyVersion: store ? (terms.privacy?.version ?? null) : null,
    appTermsVersion: terms.appTerms?.version ?? null,
    appPrivacyVersion: terms.appPrivacy?.version ?? null,
  };
}
