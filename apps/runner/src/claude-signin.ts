import type { ChildExit } from './ai-process';
import type { EngineSignin, SigninPrompt } from './engine-adapter';

// claude setup-token: 주소를 알린다 → 주인이 브라우저에서 받은 코드를 붙여 넣는다 → 러너가 쳐 넣는다 → 화면에 1년 토큰.
// 정해진 모양의 값만 꺼낸다. 서버도 같은 모양을 한 번 더 본다 (EngineLogin).
// 읽는 규칙은 Paperclip이 실제 CLI 화면으로 확인한 것을 따른다 (setup-token-parse, MIT).
export class ClaudeSignin implements EngineSignin {
  private static readonly URL =
    /https:\/\/(?:claude\.ai\/oauth\/authorize|claude\.com\/cai\/oauth\/authorize)\?[A-Za-z0-9\-._~:/?@!$&'()*+,;=%]+(?=\s)/;
  private static readonly TOKEN = /sk-ant-oat01-[A-Za-z0-9_-]{20,}/g;
  private static readonly TOKEN_START = 'Your OAuth token';
  private static readonly TOKEN_END = 'Store this token';

  readonly flow = 'paste_code';
  readonly args: readonly string[] = ['setup-token'];

  async prepare(): Promise<void> {}

  env(configDir: string): Readonly<Record<string, string>> {
    return { CLAUDE_CONFIG_DIR: configDir };
  }

  /** 끝까지 그려진 주소만 (뒤에 글자가 더 와야 다 온 것이다). 코드는 없다 */
  read(screenText: string): SigninPrompt | null {
    const url = ClaudeSignin.URL.exec(screenText)?.[0];
    return url === undefined ? null : { url, userCode: null };
  }

  async credential(
    screenText: string,
    _configDir: string,
    exitedOk: boolean,
  ): Promise<string | null> {
    return ClaudeSignin.token(screenText, exitedOk);
  }

  /** 코드를 넣은 뒤 끝났으면 코드가 틀렸거나 로그인을 마치지 못한 것이다 */
  failure(_exit: ChildExit, typed: boolean, how: string): string | null {
    return typed
      ? `코드가 맞지 않거나 로그인을 마치지 못했어요 (${how}). 다시 시작해 주세요`
      : null;
  }

  /**
   * setup-token이 그린 1년 토큰. "Your OAuth token"과 "Store this token" 사이의 마지막 것.
   * 끝 표시가 아직 없으면 토큰이 다 오지 않았을 수 있어, 명령이 잘 끝났을 때(ended)만 앞 표시 뒤에서 찾는다.
   * 표시 문구가 CLI 버전에 따라 바뀌어도 토큰은 한 번만 보이므로, 잘 끝났으면 화면 전체의 마지막 토큰을 쓴다
   * (로그인 전 화면과 붙여 넣은 코드의 메아리에는 이 모양이 없다)
   */
  static token(text: string, ended: boolean): string | null {
    const start = text.lastIndexOf(ClaudeSignin.TOKEN_START);
    if (start < 0) return ended ? (text.match(ClaudeSignin.TOKEN)?.at(-1) ?? null) : null;
    const end = text.indexOf(ClaudeSignin.TOKEN_END, start);
    if (end < 0 && !ended) return null;
    const between = text.slice(start, end < 0 ? undefined : end);
    return between.match(ClaudeSignin.TOKEN)?.at(-1) ?? null;
  }
}
