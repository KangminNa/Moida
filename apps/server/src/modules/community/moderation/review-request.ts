import { DomainEvent } from '../../platform';

// 신고 검토 요청 (2026-11-24, 스토어 3-3): 신고가 들어오면 일꾼에게 검토 일(community_review) 하나를 맡긴다.
// community는 task를 모르므로 일 요청 이벤트(task.task.requested)로 보낸다 (vault의 세션 정리와 같은 길).
// 대상 · 관리자가 마지막으로 정한 때마다 일은 하나다 (requestId): 신고가 더 와도 같은 검토가 보고,
// 관리자가 정한 뒤 새로 온 신고는 새 검토가 된다. 담당은 비워 두어 대표가 아닌 일꾼 누구나 빌린다.
// 지시는 대상의 id뿐이다: 일꾼은 community_case로 내용을 읽고(작업 토큰은 그 도구 · 제안만 쓴다, task-kinds.json의 tools)
// 판단하는 법은 스킬 cairn-moderate에 있다. 회원이 쓴 글은 지시에 싣지 않는다 (숨은 지시가 지시문에 섞이지 않게)
export class ReviewRequest {
  static readonly REQUESTED = 'task.task.requested';
  static readonly KIND = 'community_review';
  /** 사람이 기다리는 대화 일(10)보다 뒤, 정리 일과 같은 줄 */
  private static readonly PRIORITY = 0;

  static event(
    spaceId: string,
    appId: string,
    topicId: string | null,
    commentId: string | null,
    decidedAt: Date | null,
  ): DomainEvent {
    const target = commentId ?? topicId ?? '';
    const what = commentId === null ? '글' : '댓글';
    const ids = commentId === null ? `topic_id: ${topicId}` : `comment_id: ${commentId}`;
    return new DomainEvent(ReviewRequest.REQUESTED, 1, spaceId, {
      requestId: `community-review:${target}:${decidedAt?.getTime() ?? 0}`,
      kind: ReviewRequest.KIND,
      title: `커뮤니티 신고 검토: ${what}`,
      instruction: `신고된 ${what}을 검토해요. app_id: ${appId}, ${ids}`,
      payload: { communityReview: { appId, topicId, commentId } },
      priority: ReviewRequest.PRIORITY,
    });
  }
}
