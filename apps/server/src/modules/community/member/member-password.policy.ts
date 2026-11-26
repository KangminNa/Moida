import { randomInt } from 'node:crypto';
import { RuleViolation } from '../../platform';

// 회원 비밀번호 규칙 (스토어 3-1). 관리자 비밀번호와 같이 길이로 본다: 10~200자, 숫자 · 특수문자 조합은 요구하지 않는다
// (긴 문장형 비밀번호가 더 안전하다). 더해서 아이디(메일의 @ 앞) · 닉네임과 같은 값, 한 글자만 되풀이한 값,
// 유출 목록 맨 위의 흔한 값은 받지 않는다 (찔러보기에 가장 먼저 쓰인다)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class MemberPassword {
  static readonly MIN = 10;
  static readonly MAX = 200;
  /** 임시 비밀번호: 헷갈리는 글자(0 · O · 1 · l · I)를 뺀 소문자 · 숫자 16자 (약 80비트) */
  private static readonly TEMP_LENGTH = 16;
  private static readonly TEMP_LETTERS = 'abcdefghijkmnpqrstuvwxyz23456789';
  private static readonly COMMON: ReadonlySet<string> = new Set([
    '1234567890',
    '0123456789',
    '0987654321',
    '12345678910',
    '1q2w3e4r5t',
    '1qaz2wsx3edc',
    'qwertyuiop',
    'qwerty1234',
    'asdfghjkl1',
    'abcd123456',
    'password12',
    'password123',
    'password1234',
    'iloveyou12',
    'a123456789',
  ]);

  /** 규칙에 맞지 않으면 RuleViolation. 앞뒤 공백도 비밀번호의 일부다 (잘라 내지 않는다) */
  static check(plain: string, loginName: string, nickname: string): void {
    const length = [...plain].length;
    if (length < MemberPassword.MIN)
      throw new RuleViolation(`비밀번호는 ${MemberPassword.MIN}자 이상이어야 해요`);
    if (length > MemberPassword.MAX)
      throw new RuleViolation(`비밀번호는 ${MemberPassword.MAX}자 이하여야 해요`);
    const lower = plain.trim().toLowerCase();
    if (lower === loginName || lower === nickname.trim().toLowerCase())
      throw new RuleViolation('메일 · 아이디 · 닉네임과 같은 비밀번호는 쓸 수 없어요');
    if (new Set(lower).size === 1 || MemberPassword.COMMON.has(lower))
      throw new RuleViolation('너무 쉬운 비밀번호예요. 다른 비밀번호를 써 주세요');
  }

  /** 관리자가 초기화할 때 주는 임시 비밀번호 (회원이 로그인한 뒤 바꾼다) */
  static temporary(): string {
    const letters = MemberPassword.TEMP_LETTERS;
    return Array.from(
      { length: MemberPassword.TEMP_LENGTH },
      () => letters[randomInt(letters.length)],
    ).join('');
  }
}
