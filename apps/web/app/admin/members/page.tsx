import { CommunityTerms } from '../store/[id]/CommunityTerms';
import { AccountList } from './AccountList';

export const metadata = { title: '회원 계정 · Moida', robots: { index: false } };

// 설정 › 회원 계정 (스토어 계정, 2026-11-26): 이 사이트의 모든 앱이 함께 쓰는 회원 계정 목록 · 정지와 공통 약관.
// 앱마다의 닉네임 · 차단 · 글은 앱 관리의 회원 탭에서 본다
export default function MembersPage() {
  return (
    <section className="console-inner" aria-label="회원 계정">
      <CommunityTerms appId={null} />
      <AccountList />
    </section>
  );
}
