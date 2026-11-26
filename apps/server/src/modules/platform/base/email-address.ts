// 메일 주소 (2026-11-26, 메일 인증 가입): 앞뒤 공백을 빼고 소문자로 둔다. 모양만 본다 (닿는 주소인지는 인증코드가 확인한다)
export class EmailAddress {
  /** RFC 5321의 주소 길이 한도 */
  static readonly MAX = 254;
  private static readonly SHAPE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@.]+$/;

  /** 받은 글자를 주소로. 모양이 아니면 null */
  static clean(raw: string): string | null {
    const address = raw.trim().toLowerCase();
    return address.length <= EmailAddress.MAX && EmailAddress.SHAPE.test(address) ? address : null;
  }

  /** 주소처럼 생겼는가 (아이디와 메일을 한 칸에서 받을 때 가른다) */
  static looksLike(raw: string): boolean {
    return raw.includes('@');
  }
}
