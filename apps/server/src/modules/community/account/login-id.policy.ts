import { InvalidRequest } from '../../platform';

// 스토어 계정의 아이디 (2026-11-26): 영문 소문자로 시작하는 4~20자 (영문 소문자 · 숫자 · _), 받은 값을 소문자로 바꿔 둔다.
// 공간(스토어)에서 하나 (DB가 본다, 409). 로그인에 메일 대신 쓸 수 있고, 관리 화면에서 회원을 알아보는 이름이다.
// 운영자 · 서비스로 보이는 아이디는 막는다 (닉네임 규칙과 같은 까닭)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class LoginId {
  private static readonly SHAPE = /^[a-z][a-z0-9_]{3,19}$/;
  private static readonly RESERVED: ReadonlySet<string> = new Set([
    'admin',
    'administrator',
    'root',
    'system',
    'moida',
    'cairn',
    'operator',
    'manager',
    'staff',
    'support',
    'official',
    'help',
  ]);

  /** 정리한 아이디. 모양이 아니거나 막는 아이디면 loginId 칸의 오류 (422) */
  static clean(raw: string): string {
    const id = raw.trim().toLowerCase();
    if (!LoginId.SHAPE.test(id))
      throw LoginId.wrong('아이디는 영문 소문자로 시작하는 4~20자예요 (영문 소문자 · 숫자 · _)');
    if (LoginId.RESERVED.has(id)) throw LoginId.wrong('쓸 수 없는 아이디예요');
    return id;
  }

  private static wrong(message: string): InvalidRequest {
    return new InvalidRequest(new Map([['loginId', message]]));
  }
}
