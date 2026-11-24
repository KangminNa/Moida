import { redirect } from 'next/navigation';
import { MemberFrame } from '../../../../_community/MemberFrame';
import { memberPlace, memberTitle, termOf } from '../../../../_community/member-page';
import { memberReturn } from '../../../../_community/return-path';
import { JoinPanel } from './JoinPanel';

// 커뮤니티 가입 (스토어 3-2, 앱 도메인의 /_/join). 이미 회원이면 돌아갈 곳으로. 공개된 약관 둘을 읽어 동의 칸에 (3-4)
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }>; searchParams: Promise<{ return?: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '가입');
}

export default async function JoinPage({ params, searchParams }: Props) {
  const place = await memberPlace((await params).app);
  const back = memberReturn((await searchParams).return);
  if (place.member) redirect(back);
  const [terms, privacy] = await Promise.all([termOf(place, 'terms'), termOf(place, 'privacy')]);
  return (
    <MemberFrame place={place} title="가입">
      <JoinPanel
        csrf={place.csrf}
        returnTo={back}
        community={place.app.kind === 'community'}
        terms={terms}
        privacy={privacy}
      />
    </MemberFrame>
  );
}
