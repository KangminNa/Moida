import {
  BaseEntity,
  Conflict,
  DomainEvent,
  RuleViolation,
  TableEntity,
  ValueList,
} from '../../platform';
import {
  REPORT_REASON,
  type ReportNew,
  type ReportRow,
  type ReportState,
} from '../community.tables';
import { Moderation } from '../moderation/moderation.policy';
import { ReportSavedView } from './report.view';

// 회원의 신고 하나 (community.reports, 스토어 3-1c). 글이나 댓글 하나에, 한 회원이 같은 것을 한 번만 (DB 부분 유일 색인 → 409).
// 신고는 가림과 같은 트랜잭션에서 하지 않는다: 이벤트(community.report.added)를 받은 일꾼이 ModerationService.hideByReports로
// 서로 다른 회원의 신고를 세어 임시로 가린다 (신고 묶음이 글 · 댓글까지 쓰지 않게, 11.5 고르지 않은 것).
// 관리자가 대상을 정하면 열린 신고를 닫는다 (가림 · 내림은 accepted, 되돌림은 dismissed)
export class Report extends TableEntity<ReportRow, ReportNew> {
  static readonly ADDED = 'community.report.added';

  /**
   * 새 신고: topicId · commentId 가운데 하나. authorId는 대상을 쓴 회원 (TopicQuery.authorOf가 보이는 것만 준다).
   * 내가 쓴 것은 신고하지 못한다 (422). 까닭은 값 목록에서, 메모는 500자까지
   */
  static open(
    spaceId: string,
    appId: string,
    topicId: string | null,
    commentId: string | null,
    memberId: string,
    authorId: string,
    reason: string,
    note: string | null,
    now: Date,
  ): Report {
    if (authorId === memberId) throw new RuleViolation('내가 쓴 것은 신고할 수 없어요');
    if (!ValueList.has(REPORT_REASON, reason))
      throw new RuleViolation(`신고 까닭은 ${REPORT_REASON.join(' · ')} 가운데 하나예요`);
    const report = new Report(
      {
        id: BaseEntity.newId(),
        app_id: appId,
        topic_id: topicId,
        comment_id: commentId,
        member_id: memberId,
        reason,
        note: Moderation.note(note),
        created_at: now,
      },
      true,
    );
    report.record(
      new DomainEvent(Report.ADDED, 1, spaceId, {
        appId,
        reportId: report.id,
        reason,
        topicId,
        commentId,
      }),
    );
    return report;
  }

  static restore(row: ReportRow): Report {
    return new Report(row);
  }

  /** 관리자가 대상을 정해 닫는다: 열린 신고만 */
  close(outcome: ReportState, now: Date): void {
    if (this.row.state !== 'open' || outcome === 'open') throw new Conflict('이미 닫은 신고예요');
    this.put('state', outcome);
    this.put('closed_at', now);
  }

  savedView(): ReportSavedView {
    return new ReportSavedView(this.row);
  }
}
