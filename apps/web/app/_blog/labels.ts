import type { AppCodeVersion, PostStatus, PublicApp } from './types';

// 글의 화면 이름

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: '초안',
  published: '공개',
  unlisted: '링크 공개',
};

/** 글 편집기의 공개 범위 고르기 (값 · 설명) */
export const POST_STATUS_CHOICES: readonly [PostStatus, string][] = [
  ['published', '목록에 표시'],
  ['unlisted', '주소를 아는 사람만'],
  ['draft', '나만'],
];

/** 공개 범위를 바꾼 뒤의 알림 */
export const POST_STATUS_DONE: Record<PostStatus, string> = {
  draft: '초안으로 돌렸어요',
  published: '글을 공개했어요',
  unlisted: '링크 공개로 바꿨어요',
};

/** 메뉴 종류 (서버 blog.tables의 MENU_KIND) */
export const MENU_KIND_LABELS: Record<string, string> = {
  posts: '글 목록',
  issues: '호 목록',
  pages: '페이지 모음',
  page: '페이지 하나',
};

/** 앱 종류 (서버 blog.tables의 APP_KIND) */
export const APP_KIND_LABELS: Record<PublicApp['kind'], string> = {
  blog: '블로그',
  magazine: '매거진',
  page: '페이지 앱',
  community: '커뮤니티',
};

/** 앱 코드 버전이 어디서 왔나 (서버 blog.tables의 APP_CODE_VERSION_SOURCE) */
export const CODE_SOURCE_LABELS: Record<AppCodeVersion['source'], string> = {
  starter: '시작 코드',
  upload: 'zip 올림',
  task: 'AI 작업',
  restore: '복원',
};
