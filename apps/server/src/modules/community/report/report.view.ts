import type { ReportRow } from '../community.tables';

/** 신고를 받았다 (POST /api/community/reports). 누가 신고했는지 · 결과는 신고한 회원에게도 싣지 않는다 */
export class ReportSavedView {
  constructor(private readonly r: Pick<ReportRow, 'id' | 'created_at'>) {}

  toJSON() {
    return { id: this.r.id, createdAt: this.r.created_at.toISOString() };
  }
}
