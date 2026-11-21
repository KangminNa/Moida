import { BaseRequest, HostGate, NotFound, TooLarge, UnsupportedType } from '../../platform';
import { AppCodeBundle } from './app-code-bundle';
import { AppTicket } from './app-ticket';

/** 이벤트 task.app_code.built의 내용: 앱 코드를 고친 만들기 작업이 끝나며 알린 파일들. 파일의 모양은 PageFiles가 본다 */
export class AppCodeBuiltInput extends BaseRequest {
  private constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly appId: string,
    readonly note: string,
    readonly files: unknown,
  ) {
    super();
  }

  static from(raw: unknown): AppCodeBuiltInput {
    const data = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      data,
      (f) =>
        new AppCodeBuiltInput(
          f.uuid('taskId'),
          f.uuid('runId'),
          f.uuid('appId'),
          f.optionalText('note', 20_000) ?? '',
          data.files,
        ),
    );
  }
}

/**
 * POST /api/apps/:id/code/versions?version=&note=: 본문이 zip 파일 그대로다 (application/zip, HttpSetup이 그대로 받는다).
 * 형식은 머리글이 아니라 파일의 앞부분(PK)으로 본다. 묶음 전체를 바꾼다 (지운 파일은 새 버전에 없다)
 */
export class UploadCodeInput extends BaseRequest {
  /** zip 파일 자체의 크기 (푼 크기는 AppCodeBundle.BYTES_MAX) */
  static readonly MAX_BYTES = 20 * 1024 * 1024;
  private static readonly ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

  private constructor(
    readonly id: string,
    readonly version: number,
    readonly note: string,
    readonly zip: Buffer,
  ) {
    super();
  }

  static from(id: string, query: unknown, body: unknown): UploadCodeInput {
    const q = (query ?? {}) as Record<string, unknown>;
    // 주소의 값은 글자라 숫자로 바꿔 읽는다 (없거나 숫자가 아니면 틀린 필드)
    const target = BaseRequest.read(
      { id, version: Number(q.version), note: q.note ?? null },
      (f) => ({ id: f.uuid('id'), v: f.version(), note: f.optionalText('note', 200) ?? '' }),
    );
    if (!Buffer.isBuffer(body) || !body.subarray(0, 4).equals(UploadCodeInput.ZIP))
      throw new UnsupportedType('zip 파일만 올릴 수 있어요');
    if (body.length > UploadCodeInput.MAX_BYTES)
      throw new TooLarge(`zip 파일은 ${UploadCodeInput.MAX_BYTES / 1024 / 1024}MB까지예요`);
    return new UploadCodeInput(target.id, target.v, target.note, body);
  }
}

/** POST /api/apps/:id/code/current: 이 버전 공개 (되돌리기도 같다) */
export class ShowCodeInput extends BaseRequest {
  private static readonly SEQ_MAX = 2_147_483_647;

  private constructor(
    readonly id: string,
    readonly version: number,
    readonly seq: number,
  ) {
    super();
  }

  static from(id: string, raw: unknown): ShowCodeInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new ShowCodeInput(f.uuid('id'), f.version(), f.integer('seq', 1, ShowCodeInput.SEQ_MAX)),
    );
  }
}

/** 버전 하나 (바뀐 점 · zip 받기 · 미리 보기). seq 0은 시작 코드 (zip 받기 · 미리 보기만) */
export class CodeVersionInput extends BaseRequest {
  private static readonly SEQ_MAX = 2_147_483_647;

  private constructor(
    readonly id: string,
    readonly seq: number,
  ) {
    super();
  }

  static from(id: string, seq: unknown): CodeVersionInput {
    return BaseRequest.read(
      { id, seq: Number(seq) },
      (f) => new CodeVersionInput(f.uuid('id'), f.integer('seq', 0, CodeVersionInput.SEQ_MAX)),
    );
  }
}

/** POST /api/apps/:id/code/preview의 본문 { seq? }: 미리 볼 버전. 없으면 지금 보이는 버전, 0은 시작 코드 */
export class PreviewCodeInput extends BaseRequest {
  private static readonly SEQ_MAX = 2_147_483_647;

  private constructor(
    readonly id: string,
    readonly seq: number | null,
  ) {
    super();
  }

  static from(id: string, raw: unknown): PreviewCodeInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new PreviewCodeInput(f.uuid('id'), f.optionalInteger('seq', 0, PreviewCodeInput.SEQ_MAX)),
    );
  }
}

/** 앱 하나 (GET /api/apps/:id/code) */
export class AppCodeIdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): AppCodeIdInput {
    return BaseRequest.read({ id }, (f) => new AppCodeIdInput(f.uuid('id')));
  }
}

/**
 * GET /api/apps/site/:slug/screen?path=&cursor=&ticket=&host=: 앱 화면 하나 (웹의 /<앱>/… 이 넘긴다).
 * path는 앱 안의 경로 ('' · posts/<글> · m/<메뉴> · m/<메뉴>/<번호>), ticket은 미리 보기 토큰,
 * host는 방문자가 연 호스트 (스토어 3-0: 앱 도메인이면 그 도메인의 뿌리가 앱 주소, 기본 도메인이면 확인한 도메인으로 보낸다)
 */
export class AppScreenInput extends BaseRequest {
  private static readonly PATH_MAX = 600;

  private constructor(
    readonly slug: string,
    /** 앱 안 경로의 마디 (빈 마디는 뺀다) */
    readonly path: readonly string[],
    readonly cursor: string | null,
    readonly ticket: string | null,
    /** 소문자 · 포트 없이. 보내지 않으면 null (주소 기준을 바꾸지 않는다) */
    readonly host: string | null,
  ) {
    super();
  }

  static from(slug: string, query: unknown): AppScreenInput {
    const q = (query ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      {
        slug,
        path: q.path ?? '',
        cursor: q.cursor ?? null,
        ticket: q.ticket ?? null,
        host: q.host ?? null,
      },
      (f) =>
        new AppScreenInput(
          f.text('slug', 200),
          String(f.optionalText('path', AppScreenInput.PATH_MAX) ?? '')
            .split('/')
            .filter((part) => part !== '')
            .map((part) => AppScreenInput.decoded(part)),
          f.optionalText('cursor', 200),
          AppScreenInput.ticketOf(f.optionalText('ticket', 2000)),
          HostGate.normalize(f.optionalText('host', 300)),
        ),
    );
  }

  /** 주소의 마디는 인코딩된 채로 와도 같다 (글 주소에 한글이 든다). 풀 수 없으면 그대로 */
  private static decoded(part: string): string {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  }

  /** 토큰 앞의 표시(~)는 있어도 없어도 같다 */
  static ticketOf(raw: string | null): string | null {
    if (raw === null) return null;
    const token = raw.startsWith(AppTicket.MARK) ? raw.slice(1) : raw;
    return token === '' ? null : token;
  }
}

/** GET /api/apps/site/:slug/files/*path?ticket=: 앱 코드의 파일 하나 (웹의 /<앱>/files/<이름>, 정적 앱은 /<앱>/<경로>) */
export class AppFileInput extends BaseRequest {
  private constructor(
    readonly slug: string,
    readonly name: string,
    readonly ticket: string | null,
  ) {
    super();
  }

  static from(slug: string, path: string | readonly string[], query: unknown): AppFileInput {
    const ticket = (query as { ticket?: unknown } | null)?.ticket ?? null;
    // 폴더가 든 이름(정적 앱의 assets/app.js)도 받는다. 묶음의 파일 목록과 글자 그대로 맞는 것만 나간다
    const parts = typeof path === 'string' ? path.split('/') : [...path];
    if (parts.length === 0 || parts.some((part) => part === '' || part.startsWith('.')))
      throw new NotFound('없는 파일이에요');
    return BaseRequest.read(
      { slug, name: parts.join('/'), ticket },
      (f) =>
        new AppFileInput(
          f.text('slug', 200),
          f.text('name', 300),
          AppScreenInput.ticketOf(f.optionalText('ticket', 2000)),
        ),
    );
  }

  /** 웹이 템플릿으로 채우는 파일은 파일로 내보내지 않는다 (채우지 않은 템플릿이 그대로 보이지 않게) */
  get isTemplate(): boolean {
    return AppCodeBundle.isTemplate(this.name);
  }
}

/** MCP app_code_base: 쥔 만들기 일 */
export class AppCodeBaseInput extends BaseRequest {
  private constructor(readonly taskId: string) {
    super();
  }

  static from(raw: unknown): AppCodeBaseInput {
    return BaseRequest.read(raw, (f) => new AppCodeBaseInput(f.uuid('task_id')));
  }
}
