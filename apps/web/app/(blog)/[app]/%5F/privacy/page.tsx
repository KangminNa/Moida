import { MemberFrame } from '../../../../_community/MemberFrame';
import { memberPlace, memberTitle, termOf } from '../../../../_community/member-page';
import { TermText } from '../../../../_community/TermText';

// 개인정보처리방침 (스토어 3-4, 공통 약관 + 이 앱이 공개한 약관 2026-11-26, 앱 도메인의 /_/privacy). 회원을 받는 앱이면 누구나 본다
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '개인정보처리방침');
}

export default async function PrivacyPage({ params }: Props) {
  const place = await memberPlace((await params).app);
  const app = await termOf(place, 'privacy');
  return (
    <MemberFrame place={place} title="개인정보처리방침">
      <TermText term={await termOf(place, 'privacy', true)} />
      {app && (
        <section aria-label="이 앱의 개인정보처리방침">
          <h2>이 앱의 개인정보처리방침</h2>
          <TermText term={app} />
        </section>
      )}
    </MemberFrame>
  );
}
