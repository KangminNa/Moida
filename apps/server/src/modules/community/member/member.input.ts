import {
  BaseRequest,
  type HttpRequest,
  NotFound,
  ReturnPath,
  type SecretBox,
} from '../../platform';

/**
 * 회원 요청이 온 곳 (스토어 3-1): 앱 도메인의 앱(HostGate의 appId)과 그 출처. 회원 API는 앱 도메인에서만 쓴다:
 * 기본 도메인(콘솔과 같은 출처)에서는 없는 주소와 같다. 출처는 앞단 프록시가 넘긴 X-Forwarded-Host(포트까지), 없으면 Host
 */
export class MemberPlace extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly origin: string,
  ) {
    super();
  }

  static from(req: HttpRequest): MemberPlace {
    if (!req.appId) throw new NotFound('없는 주소예요');
    const raw = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    const host = raw.split(',')[0]?.trim().toLowerCase() || (req.appHost ?? '');
    return new MemberPlace(req.appId, `${req.protocol}://${host}`);
  }

  /** 소셜 로그인이 돌아올 주소 (그 서비스에 앱 도메인마다 등록한다) */
  callbackUrl(method: string): string {
    return `${this.origin}/api/community/login/${encodeURIComponent(method)}/callback`;
  }
}

/** 회원 로그인 시작: ?return=/글/주소. 돌아갈 곳은 이 도메인 안의 경로만 (ReturnPath) */
export class MemberStartInput extends BaseRequest {
  private constructor(
    readonly method: string,
    readonly returnTo: string,
  ) {
    super();
  }

  static from(method: string, query: unknown): MemberStartInput {
    return BaseRequest.read(query, (f) => {
      const returnTo = ReturnPath.safe(f.optionalText('return', 300) ?? '/');
      if (returnTo === null) f.reject('return', '이 사이트 안의 경로(/로 시작)여야 해요');
      return new MemberStartInput(method, returnTo ?? '/');
    });
  }
}

/**
 * 소셜 로그인 서비스가 돌려보낸 요청. 쿼리의 state가 로그인을 시작한 브라우저의 쿠키(봉인한 "state|돌아갈 곳|앱")와 맞아야 한다.
 * 다른 앱 · 다른 방법에서 시작한 쿠키는 풀리지 않는다
 */
export class MemberCallbackInput extends BaseRequest {
  static readonly COOKIE = 'cairn_member_login';
  static readonly SECONDS = 600;
  private static readonly PURPOSE = 'member-login';

  private constructor(
    readonly method: string,
    readonly query: ReadonlyMap<string, string>,
    readonly returnTo: string,
  ) {
    super();
  }

  /** 시작할 때 브라우저에 줄 쿠키 값 */
  static cookieFor(box: SecretBox, state: string, start: MemberStartInput, appId: string): string {
    return box.pack(
      MemberCallbackInput.purposeOf(start.method),
      JSON.stringify([state, start.returnTo, appId]),
      MemberCallbackInput.SECONDS,
    );
  }

  static from(
    method: string,
    query: Readonly<Record<string, unknown>>,
    cookie: string | null,
    box: SecretBox,
    appId: string,
  ): MemberCallbackInput {
    return BaseRequest.read(query, (f) => {
      const state = f.text('state', 200);
      const opened = box.unpack(MemberCallbackInput.purposeOf(method), cookie);
      const [expected, returnTo, app] = opened ? (JSON.parse(opened) as string[]) : [];
      if (!expected || expected !== state || app !== appId)
        f.reject('state', '로그인을 시작한 브라우저에서 10분 안에 다시 해 주세요');
      const values = new Map<string, string>();
      for (const [key, value] of Object.entries(query))
        if (typeof value === 'string') values.set(key, value);
      return new MemberCallbackInput(method, values, returnTo || '/');
    });
  }

  private static purposeOf(method: string): string {
    return `${MemberCallbackInput.PURPOSE}:${method}`;
  }
}

/** 가입: { nickname, ageConfirmed }. 닉네임 규칙 · 만 14세 확인은 Member.join이 본다 */
export class JoinInput extends BaseRequest {
  private constructor(
    readonly nickname: string,
    readonly ageConfirmed: boolean,
  ) {
    super();
  }

  static from(raw: unknown): JoinInput {
    return BaseRequest.read(
      raw,
      (f) => new JoinInput(f.text('nickname', 60), f.boolean('ageConfirmed')),
    );
  }
}

/** 닉네임 바꾸기: { version, nickname } */
export class RenameInput extends BaseRequest {
  private constructor(
    readonly version: number,
    readonly nickname: string,
  ) {
    super();
  }

  static from(raw: unknown): RenameInput {
    return BaseRequest.read(raw, (f) => new RenameInput(f.version(), f.text('nickname', 60)));
  }
}
