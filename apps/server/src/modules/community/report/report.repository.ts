import { Conflict, Database, type Row, TableRepository } from '../../platform';
import { reports } from '../community.schema';
import type { ReportRow } from '../community.tables';
import { Report } from './report';

// community.reports ↔ Report. load · lock의 첫 값은 앱 id다. 한 회원이 같은 대상을 두 번 신고하면 DB가 막고 409로 바꾼다.
// 임시 가림은 대상을 잠근 트랜잭션에서 openReporters로 센다 (ModerationService)
export class ReportRepository extends TableRepository<ReportRow, Report> {
  protected readonly table = reports;
  protected readonly noun = '신고';

  protected toEntity(row: ReportRow): Report {
    return Report.restore(row);
  }

  protected override select(appId: string, id: string, lock: boolean): Promise<readonly Row[]> {
    return this.rows(reports, { id, app_id: appId }, { lock });
  }

  override async save(report: Report): Promise<void> {
    try {
      await super.save(report);
    } catch (error) {
      if (
        Database.isUniqueViolation(error, 'reports_once_topic') ||
        Database.isUniqueViolation(error, 'reports_once_comment')
      )
        throw new Conflict('이미 신고했어요');
      throw error;
    }
  }

  /** 이 회원이 since 뒤에 한 신고 수 (시간당 한도) */
  async countSince(memberId: string, since: Date): Promise<number> {
    const [row] = await this.sql<{ n: string }[]>`
      SELECT count(*) AS n FROM community.reports WHERE member_id = ${memberId} AND created_at > ${since}`;
    return Number(row?.n ?? 0);
  }

  /** 대상(글이나 댓글)의 열린 신고를 잠근다 (관리자가 정할 때 닫으려고). 잠그는 순서는 대상 → 신고 */
  lockOpen(topicId: string | null, commentId: string | null): Promise<Report[]> {
    return this.find(
      commentId === null
        ? { topic_id: topicId, state: 'open' }
        : { comment_id: commentId, state: 'open' },
      { order: ['id'], lock: true },
    );
  }

  /** 대상을 신고한 서로 다른 회원 수: 열린 신고 가운데 관리자가 마지막으로 정한 때(since) 뒤의 것만 */
  async openReporters(
    topicId: string | null,
    commentId: string | null,
    since: Date | null,
  ): Promise<number> {
    const target =
      commentId === null ? this.sql`topic_id = ${topicId}` : this.sql`comment_id = ${commentId}`;
    const after = since === null ? this.sql`` : this.sql`AND created_at > ${since}`;
    const [row] = await this.sql<{ n: string }[]>`
      SELECT count(DISTINCT member_id) AS n FROM community.reports
      WHERE ${target} AND state = 'open' ${after}`;
    return Number(row?.n ?? 0);
  }
}
