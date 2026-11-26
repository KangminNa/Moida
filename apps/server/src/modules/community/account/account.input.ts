import { BaseRequest, type HttpRequest, NotFound } from '../../platform';
import { Agreement } from '../member/member.input';

/** 인증코드 받기 (가입 · 비밀번호 다시 정하기 · 메일 등록): { email }. 주소 모양은 Service가 EmailAddress로 본다 */
export class CodeRequestInput extends BaseRequest {
  private constructor(readonly email: string) {
    super();
  }

  static from(raw: unknown): CodeRequestInput {
    return BaseRequest.read(raw, (f) => new CodeRequestInput(f.text('email', 320)));
  }
}

/**
 * 가입: { email, code, loginId, password, nickname, ageConfirmed, …Agreement } (스토어 계정, 2026-11-26).
 * 계정 하나를 만들고 가입한 앱에 바로 참여한다 (닉네임은 그 앱의 것). 비밀번호는 앞뒤 공백까지 그대로 받는다.
 * 코드 · 아이디 · 비밀번호 · 닉네임 규칙과 만 14세 확인은 도메인이 본다
 */
export class JoinInput extends BaseRequest {
  private constructor(
    readonly email: string,
    readonly code: string,
    readonly loginId: string,
    readonly password: string,
    readonly nickname: string,
    readonly ageConfirmed: boolean,
    readonly agreement: Agreement,
  ) {
    super();
  }

  static from(raw: unknown): JoinInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new JoinInput(
          f.text('email', 320),
          f.text('code', 20),
          f.text('loginId', 40),
          f.text('password', 400),
          f.text('nickname', 60),
          f.boolean('ageConfirmed'),
          Agreement.of(f),
        ),
    );
  }
}

/**
 * 스토어에서 가입 (2026-11-26, 사용자 "스토어 가입을 넣고 회원가입 페이지 따로"): 기본 도메인으로 온 요청의 공간과 곳.
 * 앱 도메인이면 없는 주소와 같은 404 (앱 도메인에서는 그 앱의 /_/join). 공간은 HostGate가 적는다
 */
export class StorePlace extends BaseRequest {
  private constructor(
    readonly spaceId: string,
    /** 요청한 곳 (시도 제한의 열쇠, 서버 메모리에서만 쓰고 저장하지 않는다) */
    readonly ip: string,
  ) {
    super();
  }

  static from(req: HttpRequest): StorePlace {
    if (req.appHost || !req.siteSpaceId) throw new NotFound('없는 주소예요');
    return new StorePlace(req.siteSpaceId, req.ip ?? '');
  }
}

/**
 * 스토어 가입: { email, code, loginId, password, ageConfirmed, termsVersion, privacyVersion }. 계정만 만들고 로그인하지 않는다:
 * 기본 도메인은 콘솔과 같은 출처라 회원 쿠키를 두지 않는다. 앱에는 그 앱 도메인에서 로그인한 뒤 닉네임을 정해 참여한다
 */
export class StoreJoinInput extends BaseRequest {
  private constructor(
    readonly email: string,
    readonly code: string,
    readonly loginId: string,
    readonly password: string,
    readonly ageConfirmed: boolean,
    readonly agreement: Agreement,
  ) {
    super();
  }

  static from(raw: unknown): StoreJoinInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new StoreJoinInput(
          f.text('email', 320),
          f.text('code', 20),
          f.text('loginId', 40),
          f.text('password', 400),
          f.boolean('ageConfirmed'),
          Agreement.of(f),
        ),
    );
  }
}

/** 비밀번호 다시 정하기: { email, code, password }. code는 그 메일로 받은 인증코드 */
export class ResetPasswordInput extends BaseRequest {
  private constructor(
    readonly email: string,
    readonly code: string,
    readonly password: string,
  ) {
    super();
  }

  static from(raw: unknown): ResetPasswordInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new ResetPasswordInput(f.text('email', 320), f.text('code', 20), f.text('password', 400)),
    );
  }
}

/** 로그인: { login, password }. login은 메일이나 아이디. 앞뒤 공백을 빼고 소문자로 찾는다 */
export class LoginInput extends BaseRequest {
  private constructor(
    readonly login: string,
    readonly password: string,
  ) {
    super();
  }

  static from(raw: unknown): LoginInput {
    return BaseRequest.read(
      raw,
      (f) => new LoginInput(f.text('login', 320).trim().toLowerCase(), f.text('password', 400)),
    );
  }
}

/** 비밀번호 바꾸기: { current, next } */
export class PasswordInput extends BaseRequest {
  private constructor(
    readonly current: string,
    readonly next: string,
  ) {
    super();
  }

  static from(raw: unknown): PasswordInput {
    return BaseRequest.read(
      raw,
      (f) => new PasswordInput(f.text('current', 400), f.text('next', 400)),
    );
  }
}

/** 아이디 정하기 (아이디가 없는 옛 계정만): { version, loginId } */
export class LoginIdInput extends BaseRequest {
  private constructor(
    readonly version: number,
    readonly loginId: string,
  ) {
    super();
  }

  static from(raw: unknown): LoginIdInput {
    return BaseRequest.read(raw, (f) => new LoginIdInput(f.version(), f.text('loginId', 40)));
  }
}

/** 메일 등록 (메일이 없는 옛 계정만): { email, code }. code는 그 메일로 받은 인증코드 */
export class EmailInput extends BaseRequest {
  private constructor(
    readonly email: string,
    readonly code: string,
  ) {
    super();
  }

  static from(raw: unknown): EmailInput {
    return BaseRequest.read(raw, (f) => new EmailInput(f.text('email', 320), f.text('code', 20)));
  }
}

/** 관리자의 계정 정지 · 풀기: { version, until? } (until이 없으면 무기한) */
export class SuspendInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly until: Date | null,
  ) {
    super();
  }

  static from(id: string, raw: unknown): SuspendInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) => new SuspendInput(f.uuid('id'), f.version(), f.optionalDate('until')),
    );
  }
}

/** 관리의 계정 목록: ?cursor= (마지막 계정 id) */
export class AccountListInput extends BaseRequest {
  private constructor(readonly cursor: string | null) {
    super();
  }

  static from(query: unknown): AccountListInput {
    return BaseRequest.read(query, (f) => {
      const cursor = f.optionalText('cursor', 36);
      if (cursor !== null) f.uuid('cursor');
      return new AccountListInput(cursor);
    });
  }
}
