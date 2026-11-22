import { notFound } from 'next/navigation';
import { MemberFrame } from '../../../../../_community/MemberFrame';
import {
  communityPlace,
  memberTitle,
  shownTopic,
  signedIn,
  writeNotice,
} from '../../../../../_community/member-page';
import { WritePanel } from '../WritePanel';

// 내 글 고치기 · 지우기 (스토어 3-2, /_/write/<글>). 남의 글 · 없는 글 · 가려진 글은 없는 주소
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string; topic: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '글 고치기');
}

export default async function EditTopicPage({ params }: Props) {
  const { app, topic: id } = await params;
  const place = await communityPlace(app);
  // 고치기는 차단만 막는다 (가입 대기는 새 글 · 댓글만, 서버 Topic 규칙)
  const member = signedIn(place, `/_/write/${encodeURIComponent(id)}`);
  const topic = await shownTopic(place, id);
  if (!topic.mine) notFound();
  return (
    <MemberFrame place={place} title="글 고치기">
      <WritePanel csrf={place.csrf} topic={topic} notice={writeNotice(member, false)} />
    </MemberFrame>
  );
}
