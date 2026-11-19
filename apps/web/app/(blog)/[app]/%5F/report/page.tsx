import { notFound } from 'next/navigation';
import { MemberFrame } from '../../../../_community/MemberFrame';
import {
  memberPlace,
  memberTitle,
  shownTopic,
  signedIn,
  writeNotice,
} from '../../../../_community/member-page';
import { ReportPanel } from './ReportPanel';

// 신고 (스토어 3-2, /_/report?topic=<글> · ?comment=<댓글>&topic=<글>). 보이는 남의 글 · 댓글에만.
// 3명이 신고하면 운영자가 보기 전까지 임시로 가려진다 (서버 Moderation.HIDE_AT)
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ app: string }>;
  searchParams: Promise<{ topic?: string; comment?: string }>;
};

export async function generateMetadata({ params }: Props) {
  return memberTitle((await params).app, '신고');
}

export default async function ReportPage({ params, searchParams }: Props) {
  const place = await memberPlace((await params).app);
  const { topic: topicId = '', comment: commentId } = await searchParams;
  const query = new URLSearchParams({
    topic: topicId,
    ...(commentId ? { comment: commentId } : {}),
  });
  const member = signedIn(place, `/_/report?${query}`);
  const topic = await shownTopic(place, topicId);
  const comment = commentId ? topic.comments.find((c) => c.id === commentId) : null;
  if (comment === undefined || (comment ?? topic).mine) notFound();
  return (
    <MemberFrame place={place} title="신고">
      <ReportPanel
        csrf={place.csrf}
        topicId={topic.id}
        commentId={comment?.id ?? null}
        target={comment ? comment.body : topic.title}
        notice={writeNotice(member, false)}
      />
    </MemberFrame>
  );
}
