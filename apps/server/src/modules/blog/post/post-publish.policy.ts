import { type Actor, ApprovedActor, DomainEvent, Forbidden } from '../../platform';
import type { PostRow } from '../blog.tables';

// 결재한 공개의 요청자와 결과 이벤트 (Post.publishApproved와 PostService.publishApproved가 쓴다).
// 결과를 기록하지 않고 돌려주므로, 같은 결재가 다시 오면 앞서 남긴 결과를 그대로 다시 낸다 (sameResult).
// 이 결과는 공개 · 블로그 메뉴의 호 발행(2차 6단계)이 함께 쓴다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 결재 결과 규칙 한 곳
export class PostPublish {
  /** 결재로 맡기는 공개 (task.approvals.action) */
  static readonly ACTION = 'blog.post.publish';
  /** 대상이 없어 결재한 공개를 하지 못했을 때의 이유 */
  static readonly NO_POST = '없는 글이라 공개하지 않았어요';
  private static readonly FAILED = 'blog.post.publish_failed';

  /**
   * 결재한 대로 공개할 수 없는 이유 (없으면 null). 공개 범위를 바꿔도 버전이 오르므로 사람이 먼저 공개했으면 바뀐 글이다.
   * 앱에 넣지 않은 글은 공개하지 않는다 (스토어 1단계)
   */
  static problemOf(
    post: Readonly<Pick<PostRow, 'deleted_at' | 'status' | 'app_id'>>,
    version: number,
    targetVersion: number,
  ): string | null {
    if (post.deleted_at) return '휴지통에 있는 글이라 공개하지 않았어요';
    if (version !== targetVersion)
      return `승인 요청 뒤 바뀐 글이라 공개하지 않았어요 (요청 때 버전 ${targetVersion}, 지금 ${version})`;
    if (post.status === 'published') return '이미 공개된 글이에요';
    if (post.app_id === null) return '앱에 넣지 않은 글이라 공개하지 않았어요';
    return null;
  }

  /** 결재로 공개하는 요청자의 결재 id. 그 밖의 요청자(주인도)와 다른 동작의 결재는 이 길로 오지 못한다 */
  static approvalOf(by: Actor, action = PostPublish.ACTION): string {
    if (by instanceof ApprovedActor && by.action === action) return by.approvalId;
    throw new Forbidden('publish', '승인한 공개만 할 수 있어요');
  }

  /** 결재한 공개의 실패 결과. 글을 찾지 못해도 작업은 끝나야 해서 글 없이 만든다 */
  static failed(spaceId: string, postId: string, approvalId: string, error: string): DomainEvent {
    return new DomainEvent(PostPublish.FAILED, 1, spaceId, {
      postId,
      approvalId,
      outcome: 'failed',
      error,
    });
  }

  /** 앞서 낸 결과 그대로 (같은 결재가 다시 왔을 때). before는 그 이벤트의 toJSON() */
  static sameResult(spaceId: string, before: Readonly<Record<string, unknown>>): DomainEvent {
    return new DomainEvent(
      String(before.name),
      Number(before.v),
      spaceId,
      before.data as Readonly<Record<string, unknown>>,
    );
  }
}
