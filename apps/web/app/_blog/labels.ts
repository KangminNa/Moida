import type { PostStatus } from './types';

// 글의 화면 이름

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: '초안',
  published: '공개',
  unlisted: '링크 공개',
};

/** 메뉴 종류 (서버 Menu.KINDS) */
export const MENU_KIND_LABELS: Record<string, string> = {
  posts: '글 목록',
  issues: '호 목록',
  pages: '페이지 모음',
  page: '페이지 하나',
};
