import { MemberFrame } from '../../../../_community/MemberFrame';
import { memberPlace, memberTitle, termOf } from '../../../../_community/member-page';
import { TermText } from '../../../../_community/TermText';

// 이용약관 (스토어 3-4, 앱 도메인의 /_/terms). 회원을 받는 앱이면 누구나 본다
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '이용약관');
}

export default async function TermsPage({ params }: Props) {
  const place = await memberPlace((await params).app);
  return (
    <MemberFrame place={place} title="이용약관">
      <TermText term={await termOf(place, 'terms')} />
    </MemberFrame>
  );
}
