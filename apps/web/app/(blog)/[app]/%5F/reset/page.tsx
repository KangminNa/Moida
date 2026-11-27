import { redirect } from 'next/navigation';
import { MemberFrame } from '../../../../_community/MemberFrame';
import { memberPlace, memberTitle } from '../../../../_community/member-page';
import { memberReturn } from '../../../../_community/return-path';
import { ResetPanel } from './ResetPanel';

// 비밀번호 다시 정하기 (2026-11-26, 앱 도메인의 /_/reset?return=): 메일로 받은 인증코드로 새 비밀번호를 정한다.
// 로그인해 있으면 내 정보의 비밀번호 바꾸기를 쓰므로 돌아갈 곳으로
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }>; searchParams: Promise<{ return?: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '비밀번호 다시 정하기');
}

export default async function ResetPage({ params, searchParams }: Props) {
  const place = await memberPlace((await params).app);
  const back = memberReturn((await searchParams).return, place.base);
  if (place.member) redirect(back);
  return (
    <MemberFrame place={place} title="비밀번호 다시 정하기">
      <ResetPanel base={place.base} csrf={place.csrf} returnTo={back} />
    </MemberFrame>
  );
}
