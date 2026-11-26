import { redirect } from 'next/navigation';
import { MemberFrame } from '../../../../_community/MemberFrame';
import { memberPlace, memberTitle, termsOf } from '../../../../_community/member-page';
import { memberReturn } from '../../../../_community/return-path';
import { EnterPanel } from './EnterPanel';

// 앱 참여 (스토어 계정, 2026-11-26, 앱 도메인의 /_/enter?return=): 이 사이트의 계정으로 로그인했지만 이 앱의 회원이 아니면
// 닉네임을 정하고(이 앱이 약관을 공개했으면 그 약관에, 공통 약관에 아직 동의하지 않은 옛 계정이면 공통 약관에도 동의) 참여한다.
// 로그인하지 않았으면 로그인 화면으로, 이미 회원이면 돌아갈 곳으로
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }>; searchParams: Promise<{ return?: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '참여');
}

export default async function EnterPage({ params, searchParams }: Props) {
  const place = await memberPlace((await params).app);
  const back = memberReturn((await searchParams).return);
  if (place.member) redirect(back);
  if (!place.account) redirect(`/_/login?return=${encodeURIComponent(back)}`);
  return (
    <MemberFrame place={place} title={`${place.app.name} 참여`}>
      <EnterPanel
        csrf={place.csrf}
        returnTo={back}
        account={place.account}
        terms={await termsOf(place)}
      />
    </MemberFrame>
  );
}
