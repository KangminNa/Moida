import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NoticeCatalog, NoticeKind } from '../platform';
import { Decision } from './moderation/decision';
import { Report } from './report/report';

// community가 알리는 것 (스토어 3-1c). 어디로 · 언제 보낼지는 platform이 정한다.
//   신고로 가림(즉시): 신고가 쌓여 글 · 댓글을 임시로 가렸다. 관리자가 그 대상을 정하면(가림 · 되돌림 · 내림) 읽음
//   새 신고(묶어서): 앱마다 안 읽은 알림 하나에 모인다
@Injectable()
export class CommunityNotices implements OnModuleInit {
  static readonly HIDDEN = 'community.content.hidden';
  static readonly REPORTED = 'community.report.added';
  private static readonly REASONS: Readonly<Record<string, string>> = {
    spam: '스팸 · 광고',
    abuse: '욕설 · 괴롭힘',
    illegal: '불법 · 권리 침해',
    privacy: '개인정보 노출',
    other: '그 밖의 까닭',
  };

  constructor(private readonly catalog: NoticeCatalog) {}

  onModuleInit(): void {
    this.catalog.define(
      new NoticeKind(CommunityNotices.HIDDEN, '신고로 가린 글', NoticeKind.IMMEDIATE)
        .from([Decision.HIDDEN], (e) => ({
          title: e.data.commentId ? '신고로 가린 댓글' : '신고로 가린 글',
          body: `신고 ${String(e.data.reports)}건이 쌓여 임시로 가렸어요. 확인해 주세요`,
          link: CommunityNotices.linkOf(e.data.appId),
          group_key: CommunityNotices.hiddenKey(e.data),
          data: { appId: e.data.appId, topicId: e.data.topicId, commentId: e.data.commentId },
        }))
        .settledOn([Decision.DECIDED], (e) => CommunityNotices.hiddenKey(e.data)),
    );
    this.catalog.define(
      new NoticeKind(CommunityNotices.REPORTED, '커뮤니티 새 신고', NoticeKind.DIGEST).from(
        [Report.ADDED],
        (e) => ({
          title: '커뮤니티 새 신고',
          body: CommunityNotices.REASONS[String(e.data.reason)] ?? '',
          link: CommunityNotices.linkOf(e.data.appId),
          group_key: `community-reports:${String(e.data.appId)}`,
          data: { appId: e.data.appId, reportId: e.data.reportId },
        }),
      ),
    );
  }

  /** 앱 관리의 커뮤니티 탭 (화면은 3-2) */
  private static linkOf(appId: unknown): string {
    return `/admin/store/${String(appId)}?tab=community`;
  }

  private static hiddenKey(data: Readonly<Record<string, unknown>>): string {
    return `community-hidden:${String(data.commentId ?? data.topicId)}`;
  }
}
