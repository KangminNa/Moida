import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Database, MemberActor } from '../../platform';
import type { MemberPlace } from '../member/member.input';
import { MemberRepository } from '../member/member.repository';
import { TopicQuery } from '../topic/topic.query';
import { WriteLimits } from '../topic/write-limits.policy';
import { Report } from './report';
import type { ReportInput } from './report.input';
import { ReportRepository } from './report.repository';

// 회원의 신고 (스토어 3-1c): 앱 도메인의 공개된 커뮤니티 앱에서, 회원만. 대상(보이는 글 · 댓글과 쓴 회원)은 트랜잭션 전에
// TopicQuery.authorOf로 읽고(404), 트랜잭션에서 신고한 회원의 행을 잠근 뒤(같은 회원의 신고를 줄 세워 한도를 정확히 센다)
// 차단(403) → 시간당 한도(429) → 내 것(422) → 같은 대상 두 번(409, DB) 순서로 본다. 가림은 이벤트를 받은 일꾼이 한다
@Injectable()
export class ReportService extends BaseService {
  constructor(
    db: Database,
    private readonly topics: TopicQuery,
  ) {
    super(db);
  }

  async add(actor: Actor, place: MemberPlace, req: ReportInput): Promise<Report> {
    const me = MemberActor.require(actor, place.appId);
    const authorId = await this.topics.authorOf(actor, place, req.topicId, req.commentId);
    const now = new Date();
    return this.transaction(async (tx) => {
      const member = await new MemberRepository(tx).lock(place.appId, me.id ?? '');
      member.assertActive(now);
      const reports = new ReportRepository(tx);
      const hourAgo = new Date(now.getTime() - WriteLimits.HOUR_MS);
      WriteLimits.assertReportPace(await reports.countSince(member.id, hourAgo));
      const report = Report.open(
        place.spaceId,
        place.appId,
        req.topicId,
        req.commentId,
        member.id,
        authorId,
        req.reason,
        req.note,
        now,
      );
      await reports.save(report);
      return report;
    });
  }
}
