import { redirect } from 'next/navigation';
import { MemberFrame } from '../../../../_community/MemberFrame';
import { memberPlace, memberTitle, termsOf, toScreen } from '../../../../_community/member-page';
import { memberReturn } from '../../../../_community/return-path';
import { JoinPanel } from './JoinPanel';

// 가입 (스토어 3-2, 앱 도메인의 /_/join): 스토어 계정을 만들고 이 앱에 참여한다 (2026-11-26). 이미 회원이면 돌아갈 곳으로,
// 로그인했지만 이 앱에 참여하지 않았으면 참여 화면으로. 공통 약관 둘과 이 앱이 공개한 약관을 읽어 동의 칸에 (3-4)
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }>; searchParams: Promise<{ return?: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '가입');
}

export default async function JoinPage({ params, searchParams }: Props) {
  const place = await memberPlace((await params).app);
  const back = memberReturn((await searchParams).return, place.base);
  if (place.member) redirect(back);
  if (place.account) toScreen(place, 'enter', back);
  const terms = await termsOf(place);
  return (
    <MemberFrame place={place} title="가입">
      <JoinPanel
        base={place.base}
        csrf={place.csrf}
        returnTo={back}
        community={place.app.kind === 'community'}
        terms={terms}
      />
    </MemberFrame>
  );
}
