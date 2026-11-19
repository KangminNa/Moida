import { MemberFrame } from '../../../../_community/MemberFrame';
import {
  memberPlace,
  memberTitle,
  signedIn,
  writeNotice,
} from '../../../../_community/member-page';
import { MePanel } from './MePanel';

// 내 정보 (스토어 3-2, 앱 도메인의 /_/me): 닉네임 · 비밀번호 바꾸기, 로그아웃, 가입 대기 · 차단 안내
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '내 정보');
}

export default async function MePage({ params }: Props) {
  const place = await memberPlace((await params).app);
  const member = signedIn(place, '/_/me');
  return (
    <MemberFrame place={place} title="내 정보">
      <MePanel
        key={member.version}
        csrf={place.csrf}
        member={member}
        notice={writeNotice(member, true)}
      />
    </MemberFrame>
  );
}
