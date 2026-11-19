import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SecretBox } from '../../platform';

// 회원 쓰기의 CSRF 값 (스토어 3-1, 11.1 "쓰기마다 CSRF 토큰"). 회원 쿠키(가입 중이면 가입 표 쿠키)의 값을
// 서버 키에서 'member-csrf'로 나눈 열쇠로 서명한 값이다: 저장하지 않고, 쿠키가 바뀌면 함께 바뀐다.
// GET /api/community/me가 알려주고, 쓰기 요청은 X-Cairn-CSRF 머리글로 돌려보낸다 (MemberGuard가 본다).
// 다른 사이트는 HttpOnly 쿠키를 읽지 못하니 이 값을 만들 수 없다
export class MemberCsrf {
  static readonly HEADER = 'x-cairn-csrf';
  private static readonly LABEL = 'member-csrf';

  constructor(private readonly box: SecretBox) {}

  tokenOf(cookie: string): string {
    return createHmac('sha256', this.box.derive(MemberCsrf.LABEL))
      .update(cookie)
      .digest('base64url');
  }

  matches(cookie: string, token: unknown): boolean {
    if (typeof token !== 'string') return false;
    const want = Buffer.from(this.tokenOf(cookie));
    const got = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
