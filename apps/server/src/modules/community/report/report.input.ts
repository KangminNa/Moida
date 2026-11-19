import { BaseRequest } from '../../platform';

/**
 * 신고: { topicId | commentId, reason, note? }. 대상은 둘 가운데 하나만.
 * 까닭의 값 목록 · 메모 길이 · 내 것인지는 도메인(Report.open)이 본다
 */
export class ReportInput extends BaseRequest {
  private constructor(
    readonly topicId: string | null,
    readonly commentId: string | null,
    readonly reason: string,
    readonly note: string | null,
  ) {
    super();
  }

  static from(raw: unknown): ReportInput {
    return BaseRequest.read(raw, (f) => {
      const topicId = f.optionalText('topicId', 36);
      const commentId = f.optionalText('commentId', 36);
      if (topicId !== null) f.uuid('topicId');
      if (commentId !== null) f.uuid('commentId');
      if ((topicId === null) === (commentId === null))
        f.reject('topicId', 'topicId와 commentId 가운데 하나만 보내 주세요');
      return new ReportInput(
        topicId,
        commentId,
        f.text('reason', 40),
        f.optionalText('note', 2_000),
      );
    });
  }
}
