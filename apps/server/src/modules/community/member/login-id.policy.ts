import { RuleViolation } from '../../platform';

// 회원 아이디 (스토어 3-1, 2026-11-19 아이디 · 비밀번호 가입). 앱 안에서 하나이고 바꾸지 않는다 (닉네임은 바꿀 수 있다).
// 영문 소문자로 시작하는 4~20자 (영문 소문자 · 숫자 · _), 받은 값은 앞뒤 공백을 빼고 소문자로 둔다: 대소문자만 다른 아이디로 사칭하지 못하게.
// 운영자로 보이는 아이디는 막는다 (닉네임과 같은 까닭)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class LoginId {
  private static readonly SHAPE = /^[a-z][a-z0-9_]{3,19}$/;
  /** 이 말로 시작하면 막는다 */
  private static readonly RESERVED_PREFIXES: readonly string[] = [
    'admin',
    'cairn',
    'manager',
    'moderator',
    'official',
    'operator',
    'root',
    'staff',
    'support',
    'system',
  ];

  static clean(raw: string): string {
    const id = raw.trim().toLowerCase();
    if (!LoginId.SHAPE.test(id))
      throw new RuleViolation(
        '아이디는 영문 소문자로 시작하는 4~20자예요 (영문 소문자 · 숫자 · _)',
      );
    if (LoginId.RESERVED_PREFIXES.some((p) => id.startsWith(p)))
      throw new RuleViolation('운영자로 보이는 아이디는 쓸 수 없어요');
    return id;
  }
}
