import { RuleViolation } from '../../platform';

// 회원 닉네임 (스토어 3-1). 2~20자, 앱 안에서 하나 (비교는 nickname_key: 소문자 · 공백 없이 · 호환 문자 정리).
// 운영자로 보이는 이름은 막는다: AI 운영 팀의 글은 "운영자"로 표시되고(3-3), 회원이 운영자인 척하지 못하게
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class Nickname {
  static readonly MIN = 2;
  static readonly MAX = 20;
  /** 이 말이 들어 있으면 막는다 */
  private static readonly RESERVED_WORDS: readonly string[] = [
    '관리자',
    '운영자',
    '운영진',
    '공식',
  ];
  /** 이 말로 시작하면 막는다 (badminton처럼 가운데 든 것은 둔다) */
  private static readonly RESERVED_PREFIXES: readonly string[] = [
    'admin',
    'cairn',
    'moderator',
    'official',
    'operator',
    'system',
  ];
  /** 글자 · 숫자 · 공백 · 마침표 · 밑줄 · 붙임표만 */
  private static readonly SHAPE = /^[\p{L}\p{N} ._-]+$/u;

  /** 받은 닉네임을 정리해 돌려준다 (앞뒤 공백 · 겹친 공백). 규칙에 맞지 않으면 RuleViolation */
  static clean(raw: string): string {
    const nickname = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
    const length = [...nickname].length;
    if (length < Nickname.MIN || length > Nickname.MAX)
      throw new RuleViolation(`닉네임은 ${Nickname.MIN}~${Nickname.MAX}자예요`);
    if (!Nickname.SHAPE.test(nickname))
      throw new RuleViolation('닉네임에는 글자 · 숫자 · 공백 · . _ -만 쓸 수 있어요');
    const key = Nickname.keyOf(nickname);
    if (
      Nickname.RESERVED_WORDS.some((w) => key.includes(w)) ||
      Nickname.RESERVED_PREFIXES.some((p) => key.startsWith(p))
    )
      throw new RuleViolation('운영자로 보이는 닉네임은 쓸 수 없어요');
    return nickname;
  }

  /** 겹침을 비교하는 열쇠: 호환 문자 정리 · 소문자 · 공백 · 구두점 없이 ("Kim Lee" = "kim.lee") */
  static keyOf(nickname: string): string {
    return nickname
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s._-]/g, '');
  }
}
