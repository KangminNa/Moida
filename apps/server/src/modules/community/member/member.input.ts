import { BaseRequest, type HttpRequest, NotFound } from '../../platform';

/**
 * 회원 요청이 온 곳 (스토어 3-1): 앱 도메인의 앱(HostGate의 appId)과 그 출처. 회원 API는 앱 도메인에서만 쓴다:
 * 기본 도메인(콘솔과 같은 출처)에서는 없는 주소와 같다. 출처는 앞단 프록시가 넘긴 X-Forwarded-Host(포트까지), 없으면 Host
 */
export class MemberPlace extends BaseRequest {
  private constructor(
    readonly appId: string,
    /** 앱이 든 공간 (이벤트 · 알림이 쓴다) */
    readonly spaceId: string,
    readonly origin: string,
    /** 요청한 곳 (시도 제한의 열쇠, 서버 메모리에서만 쓰고 저장하지 않는다) */
    readonly ip: string,
  ) {
    super();
  }

  static from(req: HttpRequest): MemberPlace {
    if (!req.appId || !req.appSpaceId) throw new NotFound('없는 주소예요');
    const raw = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    const host = raw.split(',')[0]?.trim().toLowerCase() || (req.appHost ?? '');
    return new MemberPlace(req.appId, req.appSpaceId, `${req.protocol}://${host}`, req.ip ?? '');
  }
}

/**
 * 가입: { loginId, password, nickname, ageConfirmed, termsVersion, privacyVersion }. 비밀번호는 앞뒤 공백까지 그대로 받는다.
 * 아이디 · 비밀번호 · 닉네임 규칙과 만 14세 확인은 도메인(LoginId · MemberPassword · Member.join)이 본다
 */
export class JoinInput extends BaseRequest {
  private constructor(
    readonly loginId: string,
    readonly password: string,
    readonly nickname: string,
    readonly ageConfirmed: boolean,
    /** 동의한 이용약관 · 개인정보처리방침의 버전 (가입 화면이 읽은 것, 3-4) */
    readonly termsVersion: number,
    readonly privacyVersion: number,
  ) {
    super();
  }

  static from(raw: unknown): JoinInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new JoinInput(
          f.text('loginId', 40),
          f.text('password', 400),
          f.text('nickname', 60),
          f.boolean('ageConfirmed'),
          f.integer('termsVersion', 1, 1_000_000),
          f.integer('privacyVersion', 1, 1_000_000),
        ),
    );
  }
}

/** 탈퇴: { password }. 지금 비밀번호가 맞아야 한다 (남이 로그인된 브라우저로 탈퇴시키지 못하게) */
export class LeaveInput extends BaseRequest {
  private constructor(readonly password: string) {
    super();
  }

  static from(raw: unknown): LeaveInput {
    return BaseRequest.read(raw, (f) => new LeaveInput(f.text('password', 400)));
  }
}

/** 로그인: { loginId, password }. 아이디는 앞뒤 공백을 빼고 소문자로 찾는다 */
export class LoginInput extends BaseRequest {
  private constructor(
    readonly loginId: string,
    readonly password: string,
  ) {
    super();
  }

  static from(raw: unknown): LoginInput {
    return BaseRequest.read(
      raw,
      (f) => new LoginInput(f.text('loginId', 40).trim().toLowerCase(), f.text('password', 400)),
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
