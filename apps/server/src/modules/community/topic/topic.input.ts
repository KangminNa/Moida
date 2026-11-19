import { BaseRequest } from '../../platform';

/** 글 목록: ?cursor= (앞 쪽 답의 nextCursor 그대로) */
export class TopicListInput extends BaseRequest {
  private constructor(readonly cursor: string | null) {
    super();
  }

  static from(query: unknown): TopicListInput {
    return BaseRequest.read(query, (f) => {
      const cursor = f.optionalText('cursor', 36);
      if (cursor !== null) f.uuid('cursor');
      return new TopicListInput(cursor);
    });
  }
}

/** 글 하나의 주소 (/topics/:id) */
export class TopicIdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): TopicIdInput {
    return BaseRequest.read({ id }, (f) => new TopicIdInput(f.uuid('id')));
  }
}

/** 새 글: { requestId, title, body }. 같은 requestId를 다시 보내면 처음 만든 글. 길이 · 링크 규칙은 Topic이 본다 */
export class TopicWriteInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly title: string,
    readonly body: string,
  ) {
    super();
  }

  static from(raw: unknown): TopicWriteInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new TopicWriteInput(f.text('requestId', 200), f.text('title', 400), f.text('body', 40_000)),
    );
  }
}

/** 글 고치기: { version, title, body } */
export class TopicEditInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly title: string,
    readonly body: string,
  ) {
    super();
  }

  static from(id: string, raw: unknown): TopicEditInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new TopicEditInput(f.uuid('id'), f.version(), f.text('title', 400), f.text('body', 40_000)),
    );
  }
}
