import { BaseRequest } from '../../platform';

/** community_case { app_id, topic_id | comment_id }: 검토할 글이나 댓글 하나 */
export class ReviewCaseInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly topicId: string | null,
    readonly commentId: string | null,
  ) {
    super();
  }

  static from(raw: unknown): ReviewCaseInput {
    return BaseRequest.read(raw, (f) => {
      const topicId = f.optionalText('topic_id', 36);
      const commentId = f.optionalText('comment_id', 36);
      if ((topicId === null) === (commentId === null))
        f.reject('topic_id', 'topic_id와 comment_id 가운데 하나만 보내요');
      if (topicId !== null) f.uuid('topic_id');
      if (commentId !== null) f.uuid('comment_id');
      return new ReviewCaseInput(f.uuid('app_id'), topicId, commentId);
    });
  }
}
