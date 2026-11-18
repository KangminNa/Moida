import { BaseRequest } from '../../platform';
import { Issue } from './issue';

// 매거진 호 입력의 모양 (2차 6단계). 뜻(제목 길이 · 발행 뒤에는 글을 바꾸지 않음)은 Issue가 본다.

/** POST /api/issues: 호 목록 메뉴에 새 호 (번호는 서버가 다음 수로) */
export class CreateIssueInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly menuId: string,
    readonly title: string,
    readonly intro: string | null,
  ) {
    super();
  }

  static from(raw: unknown): CreateIssueInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new CreateIssueInput(
          f.uuid('requestId'),
          f.uuid('menuId'),
          f.text('title', Issue.TITLE_MAX * 2),
          f.optionalText('intro', Issue.INTRO_MAX),
        ),
    );
  }
}

/** PATCH /api/issues/:id: 제목 · 소개 (보내지 않으면 그대로, 소개 ""은 지우기) */
export class UpdateIssueInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly title: string | null,
    readonly intro: string | null,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateIssueInput {
    const body = (raw ?? {}) as { intro?: unknown };
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new UpdateIssueInput(
          f.uuid('id'),
          f.version(),
          f.optionalText('title', Issue.TITLE_MAX * 2),
          body.intro === '' ? '' : f.optionalText('intro', Issue.INTRO_MAX),
        ),
    );
  }
}

/** POST /api/issues/:id/posts: 호에 든 글을 이 순서로 (빠진 글은 호에서 나온다). 발행 전에만 */
export class IssuePostsInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly postIds: readonly string[],
  ) {
    super();
  }

  static from(id: string, raw: unknown): IssuePostsInput {
    return BaseRequest.read({ ...(raw as object), id }, (f) => {
      const ids = f.optionalTextList('postIds', Issue.POSTS_MAX, 36) ?? [];
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (ids.some((v) => !uuid.test(v))) f.reject('postIds', 'UUID 목록이어야 해요');
      if (new Set(ids).size !== ids.length) f.reject('postIds', '같은 글이 두 번 있어요');
      return new IssuePostsInput(
        f.uuid('id'),
        f.version(),
        ids.map((v) => v.toLowerCase()),
      );
    });
  }
}

/** GET /api/issues?menu=: 이 메뉴(주소)의 호 */
export class ListIssuesInput extends BaseRequest {
  private constructor(
    readonly menu: string | null,
    /** 이 앱(주소)의 호만 (스토어 1단계: 매거진 앱의 첫 화면, 메뉴 주소는 앱 안에서 하나) */
    readonly app: string | null,
  ) {
    super();
  }

  static from(query: unknown): ListIssuesInput {
    return BaseRequest.read(
      query ?? {},
      (f) => new ListIssuesInput(f.optionalText('menu', 200), f.optionalText('app', 200)),
    );
  }
}

/** GET /api/issues/by-number/:app/:menu/:number: 방문자가 여는 호 하나 (메뉴 주소는 앱 안에서 하나) */
export class IssueNumberInput extends BaseRequest {
  private constructor(
    readonly app: string,
    readonly menu: string,
    readonly number: number,
  ) {
    super();
  }

  static from(app: string, menu: string, number: string): IssueNumberInput {
    return BaseRequest.read(
      { app, menu, number: Number(number) },
      (f) =>
        new IssueNumberInput(
          f.text('app', 200),
          f.text('menu', 200),
          f.integer('number', 1, 100_000),
        ),
    );
  }
}
