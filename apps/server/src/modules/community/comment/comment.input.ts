import { BaseRequest } from '../../platform';

/** 새 댓글: { requestId, body }. 같은 requestId를 다시 보내면 처음 만든 댓글. 길이 · 링크 규칙은 Comment가 본다 */
export class CommentWriteInput extends BaseRequest {
  private constructor(
    readonly topicId: string,
    readonly requestId: string,
    readonly body: string,
  ) {
    super();
  }

  static from(topicId: string, raw: unknown): CommentWriteInput {
    return BaseRequest.read(
      { ...(raw as object), topicId },
      (f) =>
        new CommentWriteInput(f.uuid('topicId'), f.text('requestId', 200), f.text('body', 4_000)),
    );
  }
}
