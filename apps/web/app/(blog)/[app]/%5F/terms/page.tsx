import { MemberFrame } from '../../../../_community/MemberFrame';
import { memberPlace, memberTitle, termOf } from '../../../../_community/member-page';
import { TermText } from '../../../../_community/TermText';

// 이용약관 (스토어 3-4, 공통 약관 + 이 앱이 공개한 약관 2026-11-26, 앱 도메인의 /_/terms). 회원을 받는 앱이면 누구나 본다
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '이용약관');
}

export default async function TermsPage({ params }: Props) {
  const place = await memberPlace((await params).app);
  const app = await termOf(place, 'terms');
  return (
    <MemberFrame place={place} title="이용약관">
      <TermText term={await termOf(place, 'terms', true)} />
      {app && (
        <section aria-label="이 앱의 이용약관">
          <h2>이 앱의 이용약관</h2>
          <TermText term={app} />
        </section>
      )}
    </MemberFrame>
  );
}
