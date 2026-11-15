// 웹 전체가 함께 쓰는 것. 서버 응답 모양은 여기에 손으로 적지 않고 서버 view에서 import type으로
// app/_<모듈>/types.ts에 만든다 (scripts/check-structure.mjs). 오류 모양만은 모든 실패 응답의 모양이라 여기 둔다.

/** 서버의 오류 모양: { code, message, fields? } */
export type ApiError = { code: string; message: string; fields?: Record<string, string> };

/** 기기 권한의 화면 이름 */
export const SCOPE_LABELS: Record<string, string> = {
  upload: '세션 저장',
  read_public: '공개 자료 읽기',
  read_all: '비공개까지 읽기',
  tidy: '위키 정리',
  write: '블로그 초안 쓰기',
  browse: '브라우저 쓰기',
  code: '코드 고치기',
  make: '파일 만들기',
  run: '작업 실행',
  delegate: '에이전트에게 맡기기',
  sandbox: '샌드박스',
  news: '소식 읽기',
  inbox: '승인 · 질문 보기',
};
