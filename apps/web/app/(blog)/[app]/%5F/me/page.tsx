import { MemberFrame } from '../../../../_community/MemberFrame';
import {
  memberPlace,
  memberTitle,
  signedAccount,
  signedIn,
  writeNotice,
} from '../../../../_community/member-page';
import { AccountFill } from './AccountFill';
import { LeavePanel } from './LeavePanel';
import { MePanel } from './MePanel';
import { NewsMail } from './NewsMail';

// 내 정보 (스토어 3-2, 앱 도메인의 /_/me): 계정 · 이 앱의 닉네임 · 비밀번호 바꾸기, 로그아웃, 가입 대기 · 차단 안내,
// 옛 계정의 빈 아이디 · 메일 채우기, 소식 메일 받기(2026-11-27), 이 앱에서 나가기 · 계정 탈퇴 (스토어 계정, 2026-11-26)
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '내 정보');
}

export default async function MePage({ params }: Props) {
  const place = await memberPlace((await params).app);
  const member = signedIn(place, '/_/me');
  const account = signedAccount(place, '/_/me');
  return (
    <MemberFrame place={place} title="내 정보">
      <MePanel
        key={`me:${member.version}`}
        base={place.base}
        csrf={place.csrf}
        account={account}
        member={member}
        notice={writeNotice(member, true)}
      />
      <AccountFill key={`fill:${account.version}`} csrf={place.csrf} account={account} />
      <NewsMail key={`news:${account.version}`} csrf={place.csrf} account={account} />
      <LeavePanel base={place.base} csrf={place.csrf} community={place.app.kind === 'community'} />
    </MemberFrame>
  );
}
