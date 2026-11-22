import { MemberFrame } from '../../../../../_community/MemberFrame';
import {
  communityPlace,
  memberTitle,
  shownTopic,
  signedIn,
  writeNotice,
} from '../../../../../_community/member-page';
import { CommentPanel } from './CommentPanel';

// 댓글 달기 + 이 글의 내 댓글 지우기 (스토어 3-2, /_/comment/<글>). 보이는 글에만
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ app: string; topic: string }> };

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '댓글');
}

export default async function CommentPage({ params }: Props) {
  const { app, topic: id } = await params;
  const place = await communityPlace(app);
  const member = signedIn(place, `/_/comment/${encodeURIComponent(id)}`);
  const topic = await shownTopic(place, id);
  return (
    <MemberFrame place={place} title="댓글">
      <CommentPanel csrf={place.csrf} topic={topic} notice={writeNotice(member, true)} />
    </MemberFrame>
  );
}
