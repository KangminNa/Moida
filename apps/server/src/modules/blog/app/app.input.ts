import {
  BaseRequest,
  FileSniff,
  type RequestFields,
  TooLarge,
  type Unchecked,
  UnsupportedType,
} from '../../platform';
import type { AppRow } from '../blog.tables';
import { Menu } from '../menu/menu';
import { App } from './app';

// 앱 입력의 모양. 뜻(이름 길이 · 주소 규칙 · 종류 · 공개 여부 값)은 App의 RULES가 검사한다.
// 보내지 않은 칸은 그대로다.

/** 고치기의 칸 (공개 여부는 관리자의 REST만, 대화의 제안에는 없다: AppEdit.SETTING) */
function changesOf(f: RequestFields, body: Record<string, unknown>): Partial<Unchecked<AppRow>> {
  const has = (name: string) => name in body;
  return {
    name: has('name') ? f.text('name', App.NAME_MAX * 2) : undefined,
    slug: has('slug') ? f.text('slug', App.SLUG_MAX * 2) : undefined,
    description: has('description') ? descriptionOf(f, body) : undefined,
    sort: has('sort') ? f.integer('sort', 0, App.SORT_MAX) : undefined,
    visibility: has('visibility') ? f.text('visibility', 20) : undefined,
    ...policyOf(f, body),
  };
}

/** 편집 방침 (스토어 2단계). ""은 지우기, 보내지 않으면 그대로 */
function policyOf(
  f: RequestFields,
  body: Record<string, unknown>,
): Pick<Partial<Unchecked<AppRow>>, 'policy'> {
  return {
    policy: !('policy' in body)
      ? undefined
      : body.policy === ''
        ? ''
        : f.text('policy', App.POLICY_MAX),
  };
}

/** 설명: ""은 지우기 */
function descriptionOf(f: RequestFields, body: Record<string, unknown>): string {
  return body.description === '' ? '' : f.text('description', App.DESCRIPTION_MAX * 2);
}

/**
 * POST /api/apps. 같은 requestId는 처음 만든 앱을 돌려준다.
 * menus: 시작 메뉴(글 목록)의 이름. 보내지 않으면 종류의 기본(블로그: 글, 매거진: 호). 페이지 앱의 pageId는 넣을 페이지 (없으면 화면은 앱 코드만, 스토어 2-6)
 */
export class CreateAppInput extends BaseRequest {
  static readonly MENUS_MAX = 5;

  private constructor(
    readonly requestId: string,
    readonly kind: string,
    readonly fields: Partial<Unchecked<AppRow>>,
    readonly menus: readonly string[] | null,
    readonly pageId: string | null,
  ) {
    super();
  }

  static from(raw: unknown): CreateAppInput {
    const body = { ...(raw as object) } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) =>
        new CreateAppInput(
          f.uuid('requestId'),
          f.text('kind', 20),
          {
            name: f.text('name', App.NAME_MAX * 2),
            slug: f.text('slug', App.SLUG_MAX * 2),
            description: 'description' in body ? descriptionOf(f, body) : undefined,
            sort: 'sort' in body ? f.integer('sort', 0, App.SORT_MAX) : undefined,
            ...policyOf(f, body),
          },
          f.optionalTextList('menus', CreateAppInput.MENUS_MAX, Menu.NAME_MAX * 2),
          body.pageId === undefined || body.pageId === null ? null : f.uuid('pageId'),
        ),
    );
  }
}

/**
 * PATCH /api/apps/:id. 본 version을 함께 보낸다 (낙관적 잠금). 종류는 바꾸지 않는다. 첫 화면 고정은 PUT /api/apps/home.
 * domain(스토어 3-0): 앱 도메인, null · ""은 빼기. 관리자의 REST만 받는다 (대화의 제안은 AppEdit.apply가 막는다)
 */
export class UpdateAppInput extends BaseRequest {
  /** 도메인 칸에 받는 글자 (규칙은 App.checkDomain: 253자) */
  private static readonly DOMAIN_MAX = 300;

  private constructor(
    readonly id: string,
    readonly version: number,
    readonly changes: Partial<Unchecked<AppRow>>,
    /** 보내지 않으면 undefined (그대로) */
    readonly domain: string | null | undefined,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateAppInput {
    const body = { ...(raw as object), id } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) =>
        new UpdateAppInput(
          f.uuid('id'),
          f.version(),
          changesOf(f, body),
          !('domain' in body)
            ? undefined
            : body.domain === null || body.domain === ''
              ? null
              : f.text('domain', UpdateAppInput.DOMAIN_MAX),
        ),
    );
  }
}

/** POST /api/apps/:id/domain/check { version, token }: 관리자의 브라우저가 앱 도메인의 /.well-known/cairn-domain에서 읽은 값 */
export class CheckDomainInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly token: string,
  ) {
    super();
  }

  static from(id: string, raw: unknown): CheckDomainInput {
    const body = { ...(raw as object), id } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) => new CheckDomainInput(f.uuid('id'), f.version(), f.text('token', 200)),
    );
  }
}

/** GET /.well-known/cairn-domain: 앱 도메인으로 온 요청의 도메인 (HostGate가 적는다). 기본 도메인이면 null (Query가 404) */
export class DomainProofInput extends BaseRequest {
  private constructor(
    readonly host: string | null,
    /** 요청의 Origin 머리글 (브라우저가 다른 출처에서 읽을 때만 붙인다). 없으면 null */
    readonly origin: string | null,
  ) {
    super();
  }

  static from(appHost: string | undefined, origin: unknown): DomainProofInput {
    return new DomainProofInput(appHost ?? null, typeof origin === 'string' ? origin : null);
  }
}

/** PUT /api/apps/home: 방문자 첫 화면으로 고정할 앱 (스토어 2단계). null은 고정 풀기 (자동) */
export class HomeAppInput extends BaseRequest {
  private constructor(readonly appId: string | null) {
    super();
  }

  static from(raw: unknown): HomeAppInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      raw,
      (f) => new HomeAppInput(body.appId === null ? null : f.uuid('appId')),
    );
  }
}

/** 주소로 앱 하나 (GET /api/apps/by-slug/:slug, 아이콘). 모양이 틀린 주소는 없는 앱과 같다 (Query가 404) */
export class AppSlugInput extends BaseRequest {
  private constructor(readonly slug: string) {
    super();
  }

  static from(slug: string): AppSlugInput {
    return BaseRequest.read({ slug }, (f) => new AppSlugInput(f.text('slug', 200)));
  }
}

/**
 * PUT /api/apps/:id/icon?version=: 본문이 그림 파일 그대로다 (image/* 머리글, 사이트 로고와 같은 모양 · 한도).
 * 형식은 머리글이 아니라 파일의 앞부분으로 정한다. SVG는 스크립트를 담을 수 있어 받지 않는다
 */
export class UploadIconInput extends BaseRequest {
  static readonly MAX_BYTES = 1024 * 1024;
  private static readonly IMAGES: readonly string[] = [
    FileSniff.PNG,
    FileSniff.JPEG,
    FileSniff.WEBP,
    FileSniff.GIF,
  ];

  private constructor(
    readonly id: string,
    readonly version: number,
    readonly bytes: Buffer,
    readonly mime: string,
  ) {
    super();
  }

  static from(id: string, query: unknown, body: unknown): UploadIconInput {
    // 주소의 값은 글자라 숫자로 바꿔 읽는다 (없거나 숫자가 아니면 틀린 필드)
    const version = Number((query as Record<string, unknown> | null)?.version);
    const target = BaseRequest.read({ id, version }, (f) => ({ id: f.uuid('id'), v: f.version() }));
    // 그림 머리글이 아니면 본문을 읽지 않아서 Buffer가 아니다
    const mime = Buffer.isBuffer(body) ? FileSniff.mimeOf(body) : null;
    if (!mime || !UploadIconInput.IMAGES.includes(mime))
      throw new UnsupportedType('PNG · JPEG · WebP · GIF 그림만 올릴 수 있어요');
    if ((body as Buffer).length > UploadIconInput.MAX_BYTES)
      throw new TooLarge('아이콘은 1MB까지예요');
    return new UploadIconInput(target.id, target.v, body as Buffer, mime);
  }
}
