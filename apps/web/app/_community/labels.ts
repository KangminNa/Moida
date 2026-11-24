import type {
  DecisionAction,
  ReportReason,
  ReportState,
  TermKind,
  TopicState,
} from '../../../server/src/modules/community/community.tables';

// 커뮤니티의 화면 이름 (스토어 3-2)

/** 신고 까닭 (서버 community.tables의 REPORT_REASON, 화면에 이 순서로) */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: '스팸 · 광고',
  abuse: '욕설 · 괴롭힘',
  illegal: '불법 정보',
  privacy: '개인정보 노출',
  other: '기타',
};

/** 글 · 댓글의 상태 (서버 TOPIC_STATE · COMMENT_STATE) */
export const CONTENT_STATE_LABELS: Record<TopicState, string> = {
  shown: '보임',
  hidden: '가림',
  removed: '내림',
  deleted: '쓴 회원이 지움',
};

/** 신고의 상태 (서버 REPORT_STATE) */
export const REPORT_STATE_LABELS: Record<ReportState, string> = {
  open: '열린 신고',
  accepted: '인정',
  dismissed: '기각',
};

/** 결정 기록의 동작 (서버 DECISION_ACTION) */
export const DECISION_ACTION_LABELS: Record<DecisionAction, string> = {
  hide: '가림',
  show: '되돌림',
  remove: '내림',
  block: '차단',
  unblock: '차단 풀기',
  reset_password: '비밀번호 초기화',
};

/** 약관의 이름 (3-4) */
export const TERM_LABELS: Record<TermKind, string> = {
  terms: '이용약관',
  privacy: '개인정보처리방침',
};
