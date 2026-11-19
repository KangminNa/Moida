import type { SecretBox } from '../../platform';

// 가입 표 (스토어 3-1): 소셜 로그인은 끝났는데 아직 회원이 아닌 브라우저가 가입 화면에서 쓰는 값.
// 앱 · 로그인 방법 · 그 서비스의 회원 번호 · 돌아갈 곳을 서버 키로 봉인해 쿠키로 둔다 (15분). 서버에는 남기지 않는다:
// 가입하지 않고 떠나면 아무것도 남지 않는다. 다른 앱의 표는 풀리지 않는다
export class JoinTicket {
  static readonly COOKIE = 'cairn_member_join';
  static readonly SECONDS = 15 * 60;
  private static readonly PURPOSE = 'member-join';

  private constructor(
    readonly appId: string,
    readonly method: string,
    readonly subject: string,
    readonly returnTo: string,
    /** 브라우저에 줄 쿠키 값 (봉인한 값) */
    readonly cookie: string,
  ) {}

  static issue(
    box: SecretBox,
    appId: string,
    method: string,
    subject: string,
    returnTo: string,
  ): JoinTicket {
    const sealed = box.pack(
      JoinTicket.PURPOSE,
      JSON.stringify([appId, method, subject, returnTo]),
      JoinTicket.SECONDS,
    );
    return new JoinTicket(appId, method, subject, returnTo, sealed);
  }

  /** 쿠키의 표. 없거나 · 지났거나 · 다른 앱의 표면 null */
  static open(box: SecretBox, cookie: string | null, appId: string): JoinTicket | null {
    const opened = box.unpack(JoinTicket.PURPOSE, cookie);
    if (opened === null || cookie === null) return null;
    const [app, method, subject, returnTo] = JSON.parse(opened) as string[];
    if (app !== appId || !method || !subject) return null;
    return new JoinTicket(app, method, subject, returnTo || '/', cookie);
  }
}
