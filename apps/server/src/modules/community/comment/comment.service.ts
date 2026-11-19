import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Database, MemberActor, type VersionInput } from '../../platform';
import type { MemberPlace } from '../member/member.input';
import { MemberRepository } from '../member/member.repository';
import { TopicQuery } from '../topic/topic.query';
import { WriteLimits } from '../topic/write-limits.policy';
import { Comment } from './comment';
import type { CommentWriteInput } from './comment.input';
import { CommentRepository } from './comment.repository';

// 커뮤니티 댓글 쓰기 (스토어 3-1b): 달기 · 지우기, 회원만 · 쓴 회원만. 보이는 글에만 단다 (트랜잭션 전에 TopicQuery로 확인:
// 그사이 글이 지워져도 댓글은 남고 보이지 않는 글 아래라 읽히지 않는다).
// 달기는 쓴 회원의 행을 잠그고(MemberRepository.lock, 회원 행은 바꾸지 않는다) 차단 · 가입 대기 → 같은 requestId → 시간당 한도 → 같은 글의 같은 본문
@Injectable()
export class CommentService extends BaseService {
  constructor(
    db: Database,
    private readonly topics: TopicQuery,
  ) {
    super(db);
  }

  async write(actor: Actor, place: MemberPlace, req: CommentWriteInput): Promise<Comment> {
    const me = MemberActor.require(actor, place.appId);
    await this.topics.assertOpen(actor, place, req.topicId);
    const now = new Date();
    return this.transaction(async (tx) => {
      const member = await new MemberRepository(tx).lock(place.appId, me.id ?? '');
      member.assertCanWrite(now);
      const comments = new CommentRepository(tx);
      const before = await comments.findByRequest(member.id, req.requestId);
      if (before) return before;
      const comment = Comment.open(
        place.appId,
        req.topicId,
        member.id,
        req.requestId,
        req.body,
        now,
      );
      WriteLimits.assertCommentPace(
        await comments.countSince(member.id, new Date(now.getTime() - WriteLimits.HOUR_MS)),
      );
      const since = new Date(now.getTime() - WriteLimits.SAME_BODY_MS);
      WriteLimits.assertFresh(
        await comments.repeated(member.id, req.topicId, comment.bodyKey, since),
      );
      await comments.save(comment);
      return comment;
    });
  }

  /** 쓴 회원이 지운다 (내용은 남는다) */
  async delete(actor: Actor, place: MemberPlace, req: VersionInput): Promise<void> {
    const me = MemberActor.require(actor, place.appId);
    await this.transaction(async (tx) => {
      const comments = new CommentRepository(tx);
      const comment = await comments.lock(place.appId, req.id);
      comment.assertAuthor(me.id ?? '');
      comment.assertVersion(req.version);
      comment.deleteByAuthor();
      await comments.save(comment);
    });
  }
}
