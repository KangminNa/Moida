import { redirect } from 'next/navigation';
import { MemberFrame } from '../../../../_community/MemberFrame';
import { memberPlace, memberTitle } from '../../../../_community/member-page';
import { memberReturn } from '../../../../_community/return-path';
import { LoginPanel } from './LoginPanel';

// 로그인 (스토어 3-2, 앱 도메인의 /_/login?return=): 스토어 계정으로 이 앱 도메인에 로그인한다 (2026-11-26).
// 이미 회원이면 돌아갈 곳으로 (웹 UX U1), 로그인했지만 이 앱에 참여하지 않았으면 참여 화면으로
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }>; searchParams: Promise<{ return?: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '로그인');
}

export default async function LoginPage({ params, searchParams }: Props) {
  const place = await memberPlace((await params).app);
  const back = memberReturn((await searchParams).return);
  if (place.member) redirect(back);
  if (place.account) redirect(`/_/enter?return=${encodeURIComponent(back)}`);
  return (
    <MemberFrame place={place} title="로그인">
      <LoginPanel csrf={place.csrf} returnTo={back} />
    </MemberFrame>
  );
}
