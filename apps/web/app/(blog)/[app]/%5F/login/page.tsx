import { redirect } from 'next/navigation';
import { MemberFrame } from '../../../../_community/MemberFrame';
import { memberPlace, memberTitle } from '../../../../_community/member-page';
import { memberReturn } from '../../../../_community/return-path';
import { LoginPanel } from './LoginPanel';

// 커뮤니티 로그인 (스토어 3-2, 앱 도메인의 /_/login?return=). 이미 로그인했으면 돌아갈 곳으로 (웹 UX U1)
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }>; searchParams: Promise<{ return?: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '로그인');
}

export default async function LoginPage({ params, searchParams }: Props) {
  const place = await memberPlace((await params).app);
  const back = memberReturn((await searchParams).return);
  if (place.member) redirect(back);
  return (
    <MemberFrame place={place} title="로그인">
      <LoginPanel csrf={place.csrf} returnTo={back} />
    </MemberFrame>
  );
}
