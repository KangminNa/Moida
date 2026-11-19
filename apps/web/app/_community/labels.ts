import type { ReportReason } from '../../../server/src/modules/community/community.tables';

// 커뮤니티의 화면 이름 (스토어 3-2)

/** 신고 까닭 (서버 community.tables의 REPORT_REASON, 화면에 이 순서로) */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: '스팸 · 광고',
  abuse: '욕설 · 괴롭힘',
  illegal: '불법 정보',
  privacy: '개인정보 노출',
  other: '기타',
};
