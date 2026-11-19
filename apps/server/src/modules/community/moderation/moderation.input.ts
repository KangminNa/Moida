import { BaseRequest } from '../../platform';

/** 관리 목록: /admin/:appId/<목록>?cursor=&state= (state는 글 · 신고 목록만, 없으면 글은 모두 · 신고는 open) */
export class AdminListInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly cursor: string | null,
    readonly state: string | null,
  ) {
    super();
  }

  static from(appId: string, query: unknown): AdminListInput {
    return BaseRequest.read({ ...(query as object), appId }, (f) => {
      const cursor = f.optionalText('cursor', 36);
      if (cursor !== null) f.uuid('cursor');
      return new AdminListInput(f.uuid('appId'), cursor, f.optionalText('state', 20));
    });
  }
}

/** 관리 화면의 글 하나: /admin/:appId/topics/:id */
export class AdminTopicInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly id: string,
  ) {
    super();
  }

  static from(appId: string, id: string): AdminTopicInput {
    return BaseRequest.read(
      { appId, id },
      (f) => new AdminTopicInput(f.uuid('appId'), f.uuid('id')),
    );
  }
}

/**
 * 글 · 댓글에 내리는 결정: /admin/:appId/topics/:id/decide · comments/:id/decide { version, action, note? }.
 * action(hide · show · remove)의 뜻은 도메인(Moderation)이 본다
 */
export class DecideInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly topicId: string | null,
    readonly commentId: string | null,
    readonly version: number,
    readonly action: string,
    readonly note: string | null,
  ) {
    super();
  }

  static topic(appId: string, id: string, raw: unknown): DecideInput {
    return DecideInput.target(appId, id, raw, true);
  }

  static comment(appId: string, id: string, raw: unknown): DecideInput {
    return DecideInput.target(appId, id, raw, false);
  }

  private static target(appId: string, id: string, raw: unknown, topic: boolean): DecideInput {
    return BaseRequest.read({ ...(raw as object), appId, id }, (f) => {
      const target = f.uuid('id');
      return new DecideInput(
        f.uuid('appId'),
        topic ? target : null,
        topic ? null : target,
        f.version(),
        f.text('action', 20),
        f.optionalText('note', 2_000),
      );
    });
  }
}

/**
 * 회원에게 내리는 결정: /admin/:appId/members/:id/block · unblock · reset-password { version, until?, note? }.
 * until은 차단에만 (없으면 무기한)
 */
export class MemberDecideInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly id: string,
    readonly version: number,
    readonly until: Date | null,
    readonly note: string | null,
  ) {
    super();
  }

  static from(appId: string, id: string, raw: unknown): MemberDecideInput {
    return BaseRequest.read(
      { ...(raw as object), appId, id },
      (f) =>
        new MemberDecideInput(
          f.uuid('appId'),
          f.uuid('id'),
          f.version(),
          f.optionalDate('until'),
          f.optionalText('note', 2_000),
        ),
    );
  }
}

/** 신고가 들어왔다 (community.report.added를 받은 일꾼): { appId, topicId | commentId } */
export class ReportedInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly topicId: string | null,
    readonly commentId: string | null,
  ) {
    super();
  }

  static from(data: unknown): ReportedInput {
    return BaseRequest.read(data, (f) => {
      const topicId = f.optionalText('topicId', 36);
      const commentId = f.optionalText('commentId', 36);
      if ((topicId === null) === (commentId === null))
        f.reject('topicId', 'topicId와 commentId 가운데 하나여야 해요');
      return new ReportedInput(f.uuid('appId'), topicId, commentId);
    });
  }
}
