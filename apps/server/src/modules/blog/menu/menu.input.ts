import { BaseRequest, type RequestFields } from '../../platform';
import type { MenuRow } from '../blog.tables';
import { Menu } from './menu';

// 메뉴 입력의 모양. 뜻(이름 길이 · 주소 모양 · 순서 범위)은 Menu의 RULES가 검사한다.
// 보내지 않은 칸은 그대로, 편집 방침 ""은 지우기다.

/** 만들기 · 고치기의 칸 */
function fieldsOf(f: RequestFields, body: Record<string, unknown>): Partial<MenuRow> {
  const has = (name: string) => name in body;
  return {
    name: has('name') ? f.text('name', Menu.NAME_MAX * 2) : undefined,
    slug: f.optionalText('slug', Menu.SLUG_MAX * 2) ?? undefined,
    sort: has('sort') ? f.integer('sort', 0, Menu.SORT_MAX) : undefined,
    policy: !has('policy')
      ? undefined
      : body.policy === ''
        ? ''
        : f.text('policy', Menu.POLICY_MAX),
    rss: has('rss') ? f.boolean('rss') : undefined,
  };
}

/** POST /api/menus. 같은 requestId는 처음 만든 메뉴를 돌려준다. 메뉴는 앱 하나에 든다 (appId, 스토어 1단계) */
export class CreateMenuInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly appId: string,
    readonly kind: string,
    readonly fields: Partial<MenuRow>,
  ) {
    super();
  }

  static from(raw: unknown): CreateMenuInput {
    const body = { ...(raw as object) } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) =>
        new CreateMenuInput(f.uuid('requestId'), f.uuid('appId'), f.text('kind', 20), {
          ...fieldsOf(f, body),
          name: f.text('name', Menu.NAME_MAX * 2),
        }),
    );
  }
}

/** PATCH /api/menus/:id. 본 version을 함께 보낸다 (낙관적 잠금). 종류는 바꾸지 않는다 */
export class UpdateMenuInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly changes: Partial<MenuRow>,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateMenuInput {
    const body = { ...(raw as object), id } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) => new UpdateMenuInput(f.uuid('id'), f.version(), fieldsOf(f, body)),
    );
  }
}

/** GET /api/menus?app=<앱 주소>: 한 앱의 메뉴만. 없으면 모든 앱 (방문자는 공개 앱만) */
export class ListMenusInput extends BaseRequest {
  private constructor(readonly app: string | null) {
    super();
  }

  static from(query: unknown): ListMenusInput {
    return BaseRequest.read(query ?? {}, (f) => new ListMenusInput(f.optionalText('app', 200)));
  }
}

/** blog_menus { app_id? } (스토어 2단계): 한 앱과 그 메뉴만. 없으면 모든 앱 */
export class ToolMenusInput extends BaseRequest {
  private constructor(readonly appId: string | null) {
    super();
  }

  static from(raw: unknown): ToolMenusInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) => new ToolMenusInput(body.app_id === undefined ? null : f.uuid('app_id')),
    );
  }
}
