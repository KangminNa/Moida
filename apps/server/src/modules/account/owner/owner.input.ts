import { BaseRequest, EmailAddress, type RequestFields } from '../../platform';

/**
 * 설치 때 관리자 계정 만들기: { "email": "me@example.com", "password": "…" } (2026-11-26, 아이디 대신 메일).
 * 메일이 로그인에 쓰는 이름(users.login)이 되고, 비밀번호를 잊으면 그 메일로 인증코드를 받는다
 */
export class CreateOwnerInput extends BaseRequest {
  private constructor(
    readonly email: string,
    readonly password: string,
  ) {
    super();
  }

  /** 메일: 앞뒤 공백을 빼고 소문자로 받는다 */
  private static readEmail(f: RequestFields): string {
    const raw = f.text('email', 320);
    const email = EmailAddress.clean(raw);
    if (raw && !email) f.reject('email', '메일 주소 모양이 아니에요');
    return email ?? '';
  }

  static from(raw: unknown): CreateOwnerInput {
    return BaseRequest.read(
      raw,
      (f) => new CreateOwnerInput(CreateOwnerInput.readEmail(f), f.text('password', 200)),
    );
  }
}

/** 비밀번호를 잊었을 때 인증코드 받기: { email } */
export class OwnerCodeInput extends BaseRequest {
  private constructor(readonly email: string) {
    super();
  }

  static from(raw: unknown): OwnerCodeInput {
    return BaseRequest.read(raw, (f) => new OwnerCodeInput(f.text('email', 320)));
  }
}

/** 인증코드로 비밀번호 다시 정하기: { email, code, password } */
export class OwnerResetInput extends BaseRequest {
  private constructor(
    readonly email: string,
    readonly code: string,
    readonly password: string,
  ) {
    super();
  }

  static from(raw: unknown): OwnerResetInput {
    return BaseRequest.read(
      raw,
      (f) => new OwnerResetInput(f.text('email', 320), f.text('code', 20), f.text('password', 200)),
    );
  }
}

/** 로그인 메일 바꾸기: { email, code, password }. code는 새 메일로 받은 인증코드, password는 지금 비밀번호 */
export class OwnerEmailInput extends BaseRequest {
  private constructor(
    readonly email: string,
    readonly code: string,
    readonly password: string,
  ) {
    super();
  }

  static from(raw: unknown): OwnerEmailInput {
    return BaseRequest.read(
      raw,
      (f) => new OwnerEmailInput(f.text('email', 320), f.text('code', 20), f.text('password', 200)),
    );
  }
}

/** 로그인: { login: 메일(2026-11-26 전에 만든 계정은 아이디), password } */
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
      (f) => new LoginInput(f.text('login', 320).trim().toLowerCase(), f.text('password', 200)),
    );
  }
}

/** PUT /api/auth/me/profile: 화면에 보일 이름 (비우면 아이디). 길이 · 글자는 Owner.rename이 본다 */
export class RenameOwnerInput extends BaseRequest {
  private constructor(
    readonly displayName: string | null,
    readonly version: number,
  ) {
    super();
  }

  static from(raw: unknown): RenameOwnerInput {
    return BaseRequest.read(
      raw,
      (f) => new RenameOwnerInput(f.optionalText('displayName', 200), f.version()),
    );
  }
}

/** 비밀번호 바꾸기: 지금 비밀번호를 한 번 더 확인한다 */
export class ChangePasswordInput extends BaseRequest {
  private constructor(
    readonly current: string,
    readonly next: string,
  ) {
    super();
  }

  static from(raw: unknown): ChangePasswordInput {
    return BaseRequest.read(
      raw,
      (f) => new ChangePasswordInput(f.text('current', 200), f.text('next', 200)),
    );
  }
}

/** 로그인 하나 (POST /api/auth/sessions/:id/end) */
export class SessionIdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): SessionIdInput {
    return BaseRequest.read({ id }, (f) => new SessionIdInput(f.uuid('id')));
  }
}
