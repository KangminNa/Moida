import { BaseRequest, NotFound } from '../../platform';
import { Page } from './page';
import { PageTicket } from './page-ticket';

/** GET /api/pages?menu=: 이 메뉴(주소)에 올린 페이지만 (2차 6단계, 공개 블로그의 /m/<주소>) */
export class ListPagesInput extends BaseRequest {
  private constructor(
    readonly menu: string | null,
    /** 이 앱(주소)에 든 페이지만 (스토어 1단계: 페이지 앱의 첫 화면, 메뉴 주소는 앱 안에서 하나) */
    readonly app: string | null,
  ) {
    super();
  }

  static from(query: unknown): ListPagesInput {
    return BaseRequest.read(
      query ?? {},
      (f) => new ListPagesInput(f.optionalText('menu', 200), f.optionalText('app', 200)),
    );
  }
}

/** GET /api/pages/:id */
export class ReadPageInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): ReadPageInput {
    return BaseRequest.read({ id }, (f) => new ReadPageInput(f.uuid('id')));
  }
}

/** PATCH /api/pages/:id: 본 version과 바꿀 것 (주지 않은 것은 그대로) */
export class EditPageInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly title: string | null,
    readonly visibility: string | null,
    /** 방향 (빈 글이면 지운다). 보내지 않으면 그대로 */
    readonly direction: string | null,
    /** 올릴 메뉴 (2차 6단계). 보내지 않으면 그대로, null은 메뉴에서 빼기 */
    readonly menuId: string | null | undefined,
    /** 넣을 앱 (스토어 1단계). 보내지 않으면 그대로, null은 앱에서 빼기 */
    readonly appId: string | null | undefined,
  ) {
    super();
  }

  static from(id: string, raw: unknown): EditPageInput {
    const body = (raw ?? {}) as { direction?: unknown; menuId?: unknown; appId?: unknown };
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new EditPageInput(
          f.uuid('id'),
          f.version(),
          f.optionalText('title', Page.TITLE_MAX),
          f.optionalText('visibility', 20),
          body.direction === '' ? '' : f.optionalText('direction', Page.DIRECTION_MAX),
          !('menuId' in body) ? undefined : body.menuId === null ? null : f.uuid('menuId'),
          !('appId' in body) ? undefined : body.appId === null ? null : f.uuid('appId'),
        ),
    );
  }
}

/** POST /api/pages/:id/current: 보일 판 */
export class SwitchPageInput extends BaseRequest {
  private static readonly SEQ_MAX = 2_147_483_647;

  private constructor(
    readonly id: string,
    readonly version: number,
    readonly seq: number,
  ) {
    super();
  }

  static from(id: string, raw: unknown): SwitchPageInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new SwitchPageInput(
          f.uuid('id'),
          f.version(),
          f.integer('seq', 1, SwitchPageInput.SEQ_MAX),
        ),
    );
  }
}

/** 이벤트 task.page.built의 내용: 만들기 작업이 끝나며 알린 파일 묶음. 파일의 모양은 PageFiles가 본다 */
export class PageBuiltInput extends BaseRequest {
  private constructor(
    readonly taskId: string,
    readonly runId: string,
    /** 고칠 페이지. 없으면 새 페이지 */
    readonly pageId: string | null,
    readonly title: string,
    readonly note: string,
    readonly files: unknown,
  ) {
    super();
  }

  static from(raw: unknown): PageBuiltInput {
    const data = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      data,
      (f) =>
        new PageBuiltInput(
          f.uuid('taskId'),
          f.uuid('runId'),
          data.pageId === undefined || data.pageId === null ? null : f.uuid('pageId'),
          f.text('title', 500),
          f.optionalText('note', 20_000) ?? '',
          data.files,
        ),
    );
  }
}

// 바깥 주소(/pages/…)의 경로: <이름> · <이름>/<파일> · ~<표>/<이름> · ~<표>/<이름>/<파일>.
// 파일 이름에는 경로가 없어 조각은 셋까지다. 모양이 아니면 없는 페이지와 같다 (404).
export class PageSiteInput {
  private constructor(
    /** 비공개 페이지의 보기 표. 없으면 로그인으로 본다 */
    readonly ticket: string | null,
    readonly name: string,
    /** 없으면 페이지의 문(index.html)으로 보낸다 */
    readonly file: string | null,
  ) {}

  static from(path: string | readonly string[]): PageSiteInput {
    const parts = (Array.isArray(path) ? path : String(path ?? '').split('/')).filter(
      (part) => part !== '',
    );
    const ticket = parts[0]?.startsWith(PageTicket.MARK) ? String(parts.shift()).slice(1) : null;
    const [name, file = null, ...rest] = parts;
    if (!name || rest.length > 0 || ticket === '') throw new NotFound('없는 페이지예요');
    return new PageSiteInput(ticket, name, file);
  }
}

/** GET /api/pages/:id/revisions/:seq/changes: 판 하나 */
export class PageRevisionInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly seq: number,
  ) {
    super();
  }

  static from(id: string, seq: string): PageRevisionInput {
    return BaseRequest.read({ id, seq }, (f) => {
      const n = Number(f.text('seq', 9));
      if (!Number.isSafeInteger(n) || n < 1) f.reject('seq', '1 이상의 버전 번호여야 해요');
      return new PageRevisionInput(f.uuid('id'), n);
    });
  }
}

/** MCP page_base { task_id }: 러너가 쥔 만들기 일 */
export class PageBaseInput extends BaseRequest {
  private constructor(readonly taskId: string) {
    super();
  }

  static from(raw: unknown): PageBaseInput {
    return BaseRequest.read(raw, (f) => new PageBaseInput(f.uuid('task_id')));
  }
}
