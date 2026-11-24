import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseService,
  Database,
  Lookups,
  NotFound,
  Outbox,
  PasswordHasher,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
} from '../../platform';
import { Comment } from '../comment/comment';
import { CommentRepository } from '../comment/comment.repository';
import type { DecisionAction } from '../community.tables';
import type { Member } from '../member/member';
import { MemberRepository } from '../member/member.repository';
import { MemberPassword } from '../member/member-password.policy';
import { ReportRepository } from '../report/report.repository';
import type { Topic } from '../topic/topic';
import { TopicRepository } from '../topic/topic.repository';
import { Decision } from './decision';
import { DecisionRepository } from './decision.repository';
import type { DecideInput, MemberDecideInput, ReportedInput } from './moderation.input';
import { Moderation } from './moderation.policy';
import { ModerationChange } from './moderation-change';
import { ReviewRequest } from './review-request';

// 커뮤니티 관리 쓰기 (스토어 3-1c): 신고로 임시 가림(일꾼) · 관리자의 가림 · 되돌림 · 내림 · 차단 · 풀기 · 비밀번호 초기화.
// 같은 모듈의 여러 묶음을 한 트랜잭션에서 쓰는 곳은 여기뿐이다 (객체설계 4장 예외, 11.5): 결정은 대상(글 · 댓글 · 회원)과
// 열린 신고 · 결정 기록을 함께 바꾼다. 잠그는 순서는 대상 → 신고 → 결정 기록(넣기만).
// 관리자 일은 기본 도메인에서 assertOwner로만 (원칙 10: 회원은 관리자가 아니다), 앱은 Lookups 'member-app'으로 공간의 회원을 받는 앱인지 본다 (스토어 12.3).
// 일꾼의 신고 검토 (3-3, 2026-11-24): 신고마다 검토 일을 요청하고(ReviewRequest), 일꾼의 제안(설정 바꾸기 moderation)은
// 관리자가 승인하면 ApprovedActor로 관리자 결정과 같은 줄(contentIn · memberIn)을 지난다 (지우기 · 제재는 승인으로만, 원칙 7 · 10)
@Injectable()
export class ModerationService extends BaseService {
  constructor(
    db: Database,
    private readonly lookups: Lookups,
    private readonly hasher: PasswordHasher,
  ) {
    super(db);
  }

  /**
   * 신고가 들어왔다 (일꾼, community.report.added): 대상을 잠그고 관리자가 마지막으로 정한 뒤의 열린 신고를 서로 다른 회원으로 세어
   * Moderation.HIDE_AT건이면 임시로 가리고 기록을 남긴다 (→ community.content.hidden → 관리자 알림). 두 번 불려도 한 번만 가린다
   */
  async hideByReports(actor: Actor, spaceId: string, req: ReportedInput): Promise<void> {
    actor.assertOwnerOrSystem();
    const now = new Date();
    await this.transaction(async (tx) => {
      const content = await ModerationService.lockContent(
        tx,
        req.appId,
        req.topicId,
        req.commentId,
      );
      if (content === null) return;
      // 검토 일은 대상 · 관리자가 정한 때마다 하나 (같은 requestId는 task가 한 번만 만든다)
      await new Outbox(tx).publish([
        ReviewRequest.event(spaceId, req.appId, req.topicId, req.commentId, content.decidedAt),
      ]);
      const reporters = await new ReportRepository(tx).openReporters(
        req.topicId,
        req.commentId,
        content.decidedAt,
      );
      if (!Moderation.reachesHide(reporters) || !content.hideByReports()) return;
      await ModerationService.saveContent(tx, content);
      await new DecisionRepository(tx).save(
        Decision.hiddenByReports(spaceId, req.appId, req.topicId, req.commentId, reporters, now),
      );
    });
  }

  /** 관리자가 글 · 댓글을 정한다 (가림 · 되돌림 · 내림). 열린 신고를 닫고(되돌림은 기각, 나머지는 인정) 기록을 남긴다 */
  async decide(actor: Actor, req: DecideInput): Promise<Topic | Comment> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.assertApp(actor, req.appId);
    const now = new Date();
    return this.transaction((tx) =>
      ModerationService.contentIn(tx, spaceId, req, actor.id, now, { write: true }),
    );
  }

  /** 관리자가 회원을 차단한다 (until까지, 없으면 무기한). 쓰기 · 신고 · 닉네임 바꾸기가 막힌다 */
  block(actor: Actor, req: MemberDecideInput): Promise<Member> {
    return this.onMember(actor, req, 'block', (member, now) => member.block(req.until, now));
  }

  /** 관리자가 차단을 푼다 */
  unblock(actor: Actor, req: MemberDecideInput): Promise<Member> {
    return this.onMember(actor, req, 'unblock', (member, now) => member.unblock(now));
  }

  /**
   * 관리자가 비밀번호를 초기화한다: 임시 비밀번호를 만들어 해시만 저장하고 모든 로그인을 끝낸다.
   * 임시 비밀번호는 답(Member.resetView)에 한 번만 싣는다. 해시는 느려서 트랜잭션 밖에서 만든다
   */
  async resetPassword(actor: Actor, req: MemberDecideInput): Promise<Member> {
    actor.assertOwner();
    const temporary = MemberPassword.temporary();
    const hash = await this.hasher.hash(temporary);
    return this.onMember(actor, req, 'reset_password', (member, now) =>
      member.resetPassword(hash, temporary, now),
    );
  }

  private async onMember(
    actor: Actor,
    req: MemberDecideInput,
    action: DecisionAction,
    change: (member: Member, now: Date) => void,
  ): Promise<Member> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.assertApp(actor, req.appId);
    const now = new Date();
    return this.transaction((tx) =>
      ModerationService.memberIn(tx, spaceId, req, action, change, actor.id, now, { write: true }),
    );
  }

  /** 일꾼의 검토 제안을 미리 해 본다 (저장하지 않음): 관리자 결정과 같은 줄에서 낡은 버전 · 맞지 않는 상태가 걸린다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    const proposed = ModerationChange.of(change);
    await this.assertApp(actor, proposed.appId);
    const now = new Date();
    await this.transaction((tx) =>
      ModerationService.changeIn(tx, spaceId, proposed, null, now, { write: false }),
    );
  }

  /** 승인한 검토 제안: 결재마다 한 번, 결정 기록은 approved(승인한 관리자). 그사이 바뀌었으면 실패로 끝난다 */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    const proposed = ModerationChange.of(change);
    await this.assertApp(actor, proposed.appId);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingOutcome.topicOf('community'),
      spaceId,
      change.key,
      async (tx) => {
        await ModerationService.changeIn(tx, spaceId, proposed, actor.id, new Date(), {
          write: true,
          approved: true,
        });
      },
    );
  }

  /** 검토 제안 하나를 결정의 줄로 (글 · 댓글 → contentIn, 회원 → memberIn) */
  private static async changeIn(
    tx: Sql,
    spaceId: string,
    proposed: ModerationChange,
    byId: string | null,
    now: Date,
    how: { write: boolean; approved?: boolean },
  ): Promise<void> {
    if (!proposed.member) {
      await ModerationService.contentIn(tx, spaceId, proposed.decideInput(), byId, now, how);
      return;
    }
    const { input, block } = proposed.memberInput();
    const change = (m: Member, at: Date) => (block ? m.block(input.until, at) : m.unblock(at));
    const action = block ? 'block' : 'unblock';
    await ModerationService.memberIn(tx, spaceId, input, action, change, byId, now, how);
  }

  /** 글 · 댓글의 결정 (관리자 · 승인한 제안 · 미리 해 보기가 같은 줄): 대상 → 열린 신고 → 기록 */
  private static async contentIn(
    tx: Sql,
    spaceId: string,
    req: DecideInput,
    byId: string | null,
    now: Date,
    how: { write: boolean; approved?: boolean },
  ): Promise<Topic | Comment> {
    const action = Moderation.contentAction(req.action);
    const content = await ModerationService.lockContent(tx, req.appId, req.topicId, req.commentId);
    if (content === null)
      throw new NotFound(req.commentId === null ? '없는 글이에요' : '없는 댓글이에요');
    content.assertVersion(req.version);
    content.decide(action, now);
    if (!how.write) return content;
    await ModerationService.saveContent(tx, content);
    const reports = new ReportRepository(tx);
    for (const report of await reports.lockOpen(req.topicId, req.commentId)) {
      report.close(Moderation.reportOutcome(action), now);
      await reports.save(report);
    }
    const { appId, topicId, commentId, note } = req;
    await new DecisionRepository(tx).save(
      Decision.content(spaceId, appId, topicId, commentId, action, byId, note, now, how.approved),
    );
    return content;
  }

  /** 회원의 결정 (관리자 · 승인한 제안 · 미리 해 보기가 같은 줄) */
  private static async memberIn(
    tx: Sql,
    spaceId: string,
    req: MemberDecideInput,
    action: DecisionAction,
    change: (member: Member, now: Date) => void,
    byId: string | null,
    now: Date,
    how: { write: boolean; approved?: boolean },
  ): Promise<Member> {
    const members = new MemberRepository(tx);
    const member = await members.lock(req.appId, req.id);
    member.assertVersion(req.version);
    change(member, now);
    if (!how.write) return member;
    await members.save(member);
    await new DecisionRepository(tx).save(
      Decision.member(spaceId, req.appId, member.id, action, byId, req.note, now, how.approved),
    );
    return member;
  }

  /** 공간의 커뮤니티 앱인가 (아니면 404) */
  private assertApp(actor: Actor, appId: string): Promise<void> {
    return this.lookups.assertVisible('member-app', actor, [appId], '없는 커뮤니티예요');
  }

  /** 대상 글이나 댓글을 잠근다 (commentId가 있으면 댓글). 그 앱에 없으면 null */
  private static lockContent(
    tx: Sql,
    appId: string,
    topicId: string | null,
    commentId: string | null,
  ): Promise<Topic | Comment | null> {
    return commentId !== null
      ? new CommentRepository(tx).lockOrNull(appId, commentId)
      : new TopicRepository(tx).lockOrNull(appId, topicId ?? '');
  }

  private static async saveContent(tx: Sql, content: Topic | Comment): Promise<void> {
    if (content instanceof Comment) await new CommentRepository(tx).save(content);
    else await new TopicRepository(tx).save(content);
  }
}
