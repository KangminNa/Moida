import { MemberFrame } from '../../../../_community/MemberFrame';
import {
  communityPlace,
  memberTitle,
  signedIn,
  writeNotice,
} from '../../../../_community/member-page';
import { WritePanel } from './WritePanel';

// 새 글 (스토어 3-2, 앱 도메인의 /_/write). 회원만, 가입 대기 · 차단이면 안내하고 보내기를 막는다
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '글쓰기');
}

export default async function WritePage({ params }: Props) {
  const place = await communityPlace((await params).app);
  const member = signedIn(place, '/_/write');
  return (
    <MemberFrame place={place} title="글쓰기">
      <WritePanel
        base={place.base}
        csrf={place.csrf}
        topic={null}
        notice={writeNotice(member, true)}
      />
    </MemberFrame>
  );
}
