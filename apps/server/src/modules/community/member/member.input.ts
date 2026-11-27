import { BaseRequest, type HttpRequest, NotFound, type RequestFields } from '../../platform';

/**
 * 회원 요청이 온 곳 (스토어 3-1): 앱 도메인의 앱(HostGate의 appId)과 그 앱이 든 공간(스토어), 출처. 회원 API는 앱 도메인에서만 쓴다:
 * 기본 도메인(콘솔과 같은 출처)에서는 없는 주소와 같다. 출처는 앞단 프록시가 넘긴 X-Forwarded-Host(포트까지), 없으면 Host
 */
export class MemberPlace extends BaseRequest {
  private constructor(
    readonly appId: string,
    /** 앱이 든 공간: 스토어 계정은 공간에 하나다 (이벤트 · 알림도 쓴다) */
    readonly spaceId: string,
    readonly origin: string,
    /** 요청한 곳 (시도 제한의 열쇠, 서버 메모리에서만 쓰고 저장하지 않는다) */
    readonly ip: string,
  ) {
    super();
  }

  static from(req: HttpRequest): MemberPlace {
    if (!req.appId || !req.appSpaceId) throw new NotFound('없는 주소예요');
    return new MemberPlace(req.appId, req.appSpaceId, MemberPlace.originOf(req), req.ip ?? '');
  }

  /** 요청이 온 출처 (쓰기의 Origin과 견준다): 앞단 프록시의 X-Forwarded-Host(첫 값)나 Host */
  static originOf(req: HttpRequest): string {
    const raw = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    const host = raw.split(',')[0]?.trim().toLowerCase() || (req.appHost ?? '');
    return `${req.protocol}://${host}`;
  }
}

/**
 * 약관 동의 (가입 · 앱 참여): 화면이 읽은 공통 약관(스토어)과 이 앱 약관의 버전. 공개되지 않은 것은 null.
 * 지금 공개된 버전인지는 TermsConsent가 본다 (화면을 연 뒤 바뀌었으면 409)
 */
export class Agreement extends BaseRequest {
  private constructor(
    readonly termsVersion: number | null,
    readonly privacyVersion: number | null,
    readonly appTermsVersion: number | null,
    readonly appPrivacyVersion: number | null,
  ) {
    super();
  }

  static of(f: RequestFields): Agreement {
    const v = (name: string) => f.optionalInteger(name, 1, 1_000_000);
    return new Agreement(
      v('termsVersion'),
      v('privacyVersion'),
      v('appTermsVersion'),
      v('appPrivacyVersion'),
    );
  }
}

/** 앱 참여: { nickname, …Agreement }. 로그인한 계정이 이 앱의 회원이 된다 (공통 약관에 아직 동의하지 않았으면 그 버전도) */
export class EnterInput extends BaseRequest {
  private constructor(
    readonly nickname: string,
    readonly agreement: Agreement,
  ) {
    super();
  }

  static from(raw: unknown): EnterInput {
    return BaseRequest.read(raw, (f) => new EnterInput(f.text('nickname', 60), Agreement.of(f)));
  }
}

/** 앱에서 나가기 · 계정 탈퇴: { password }. 지금 비밀번호가 맞아야 한다 (남이 로그인된 브라우저로 탈퇴시키지 못하게) */
export class LeaveInput extends BaseRequest {
  private constructor(readonly password: string) {
    super();
  }

  static from(raw: unknown): LeaveInput {
    return BaseRequest.read(raw, (f) => new LeaveInput(f.text('password', 400)));
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
