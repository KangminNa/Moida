import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NoticeCatalog, NoticeKind } from '../platform';
import { AppCode } from './app-code/app-code';
import { Page } from './page/page';

// blog가 알리는 것 (2차 5단계).
//   새 버전 확인: 공개 페이지에 새 판이 와서 관리자가 보이기를 기다림 (즉시). 그 판(이나 더 새 판)을 보이면 읽음
//   앱 코드 확인 (스토어 1-6): 공개 앱에 새 코드 버전이 와서 공개를 기다림 (즉시). 그 버전(이나 더 새 버전)을 공개하면 읽음
//   앱 코드 실패: AI 작업의 결과가 묶음 규칙에 맞지 않아 버전을 만들지 못함 (즉시)
@Injectable()
export class BlogNotices implements OnModuleInit {
  static readonly PAGE_PENDING = 'blog.page.pending';
  static readonly APP_CODE_PENDING = 'blog.app_code.pending';
  static readonly APP_CODE_REFUSED = 'blog.app_code.refused';

  constructor(private readonly catalog: NoticeCatalog) {}

  onModuleInit(): void {
    this.catalog.define(
      new NoticeKind(BlogNotices.PAGE_PENDING, '페이지 새 버전 확인', NoticeKind.IMMEDIATE)
        .from([Page.PENDING], (e) => ({
          title: `새 버전 확인 · ${String(e.data.title ?? '')}`,
          body: '공개 페이지라 보이기 전에 확인해요',
          link: `/admin/library/pages/${String(e.data.pageId)}`,
          group_key: `page-pending:${String(e.data.pageId)}`,
          data: { pageId: e.data.pageId, seq: e.data.seq },
        }))
        .settledOn([Page.SHOWN], (e) => `page-pending:${String(e.data.pageId)}`),
    );
    this.catalog.define(
      new NoticeKind(BlogNotices.APP_CODE_PENDING, '앱 코드 새 버전 확인', NoticeKind.IMMEDIATE)
        .from([AppCode.ADDED], (e) =>
          e.data.pending === true
            ? {
                title: `앱 코드 확인 · ${String(e.data.name ?? '')} 버전 ${String(e.data.seq)}`,
                body: '공개 앱이라 공개 전에 확인해요',
                link: `/admin/store/${String(e.data.appId)}?tab=code`,
                group_key: `app-code-pending:${String(e.data.appId)}`,
                data: { appId: e.data.appId, seq: e.data.seq },
              }
            : null,
        )
        .settledOn([AppCode.SHOWN], (e) =>
          e.data.settled === true ? `app-code-pending:${String(e.data.appId)}` : null,
        ),
    );
    this.catalog.define(
      new NoticeKind(
        BlogNotices.APP_CODE_REFUSED,
        '앱 코드 만들기 실패',
        NoticeKind.IMMEDIATE,
      ).from([AppCode.REFUSED], (e) => ({
        title: `앱 코드를 버전으로 만들지 못함 · ${String(e.data.name ?? '')}`,
        body: String(e.data.error ?? ''),
        link: `/admin/store/${String(e.data.appId)}?tab=code`,
        group_key: `app-code-refused:${String(e.data.appId)}`,
        data: { appId: e.data.appId, taskId: e.data.taskId },
      })),
    );
  }
}
