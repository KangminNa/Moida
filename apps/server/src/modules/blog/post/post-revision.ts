import { type Actor, BaseEntity, TableEntity } from '../../platform';
import type { PostRevisionNew, PostRevisionRow } from '../blog.tables';
import type { PostContent } from './post-content';

/** 글의 판 하나 (blog.post_revisions, 추가만): 그때의 제목과 본문 */
export class PostRevision extends TableEntity<PostRevisionRow, PostRevisionNew> {
  /** Actor 종류 → 판에 남기는 만든 쪽 (post_revisions.actor_type). 기기와 에이전트는 둘 다 AI 도구다 */
  private static readonly ACTOR_TYPES: Readonly<Record<string, string>> = {
    owner: 'user',
    device: 'ai',
    agent: 'ai',
    system: 'system',
  };

  /** seq: 몇 번째 판인가 (1부터). base: 바로 앞의 판 (첫 판이면 null) */
  static write(
    postId: string,
    seq: number,
    content: PostContent,
    base: string | null,
    requestId: string | null,
    by: Actor,
    now: Date,
  ): PostRevision {
    return new PostRevision(
      {
        id: BaseEntity.newId(),
        post_id: postId,
        seq,
        title: content.title,
        body_md: content.body,
        base_revision_id: base,
        request_id: requestId,
        actor_type: PostRevision.ACTOR_TYPES[by.kind] ?? 'system',
        actor_id: by.id,
        created_at: now,
      },
      true,
    );
  }
}
