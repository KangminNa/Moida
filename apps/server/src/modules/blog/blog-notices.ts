import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NoticeCatalog, NoticeKind } from '../platform';
import { Page } from './page/page';

// blog가 알리는 것 (2차 5단계).
//   새 버전 확인: 공개 페이지에 새 판이 와서 관리자가 보이기를 기다림 (즉시). 그 판(이나 더 새 판)을 보이면 읽음
@Injectable()
export class BlogNotices implements OnModuleInit {
  static readonly PAGE_PENDING = 'blog.page.pending';

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
  }
}
