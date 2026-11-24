import { BaseEntity, DomainEvent, TableEntity } from '../../platform';
import type { DecisionAction, DecisionNew, DecisionRow } from '../community.tables';
import { Moderation } from './moderation.policy';

// 관리 결정 기록 한 줄 (community.decisions, 추가만, 스토어 3-1c · 11.1 "관리자 결정 기록"). 대상은 글 · 댓글 · 회원 가운데 하나.
// 누가 정했는지(by_kind): system(신고가 쌓여 임시로 가림) · owner(관리자). approved(관리자가 승인한 일꾼의 제안, 3-3 2026-11-24).
// 기록과 함께 이벤트를 남긴다: 가림은 관리자에게 바로 알리고(CommunityNotices), 관리자의 결정은 그 알림을 읽음으로
export class Decision extends TableEntity<DecisionRow, DecisionNew> {
  static readonly HIDDEN = 'community.content.hidden';
  static readonly DECIDED = 'community.content.decided';
  static readonly MEMBER_DECIDED = 'community.member.decided';

  /** 신고가 쌓여 시스템이 임시로 가렸다 (reports: 센 회원 수) */
  static hiddenByReports(
    spaceId: string,
    appId: string,
    topicId: string | null,
    commentId: string | null,
    reports: number,
    now: Date,
  ): Decision {
    const decision = Decision.made(
      appId,
      topicId,
      commentId,
      null,
      'hide',
      null,
      `신고 ${reports}건`,
      now,
    );
    decision.record(
      new DomainEvent(Decision.HIDDEN, 1, spaceId, {
        appId,
        decisionId: decision.id,
        reports,
        topicId,
        commentId,
      }),
    );
    return decision;
  }

  /** 관리자가 글 · 댓글을 정했다 (가림 · 되돌림 · 내림) */
  static content(
    spaceId: string,
    appId: string,
    topicId: string | null,
    commentId: string | null,
    action: DecisionAction,
    ownerId: string | null,
    note: string | null,
    now: Date,
    approved = false,
  ): Decision {
    const decision = Decision.made(
      appId,
      topicId,
      commentId,
      null,
      action,
      ownerId,
      note,
      now,
      approved,
    );
    decision.record(
      new DomainEvent(Decision.DECIDED, 1, spaceId, {
        appId,
        decisionId: decision.id,
        action,
        topicId,
        commentId,
      }),
    );
    return decision;
  }

  /** 관리자가 회원을 정했다 (차단 · 풀기 · 비밀번호 초기화) */
  static member(
    spaceId: string,
    appId: string,
    memberId: string,
    action: DecisionAction,
    ownerId: string | null,
    note: string | null,
    now: Date,
    approved = false,
  ): Decision {
    const decision = Decision.made(
      appId,
      null,
      null,
      memberId,
      action,
      ownerId,
      note,
      now,
      approved,
    );
    decision.record(
      new DomainEvent(Decision.MEMBER_DECIDED, 1, spaceId, {
        appId,
        decisionId: decision.id,
        action,
        memberId,
      }),
    );
    return decision;
  }

  static restore(row: DecisionRow): Decision {
    return new Decision(row);
  }

  private static made(
    appId: string,
    topicId: string | null,
    commentId: string | null,
    memberId: string | null,
    action: DecisionAction,
    ownerId: string | null,
    note: string | null,
    now: Date,
    approved = false,
  ): Decision {
    return new Decision(
      {
        id: BaseEntity.newId(),
        app_id: appId,
        topic_id: topicId,
        comment_id: commentId,
        member_id: memberId,
        action,
        by_kind: ownerId === null ? 'system' : approved ? 'approved' : 'owner',
        by_id: ownerId,
        note: Moderation.note(note),
        created_at: now,
      },
      true,
    );
  }
}
