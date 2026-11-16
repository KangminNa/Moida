// 로그인 명령이 터미널에 그린 화면 (제어 문자열을 걷어 낸 글). 엔진마다 무엇을 꺼낼지는 EngineSignin이 안다.
// 화면은 비밀이다: 주소, 붙여 넣은 코드의 메아리, 토큰이 섞여 있다. 그래서 통째로 어디에도 보내거나 적지 않는다.
export class SigninScreen {
  /**
   * 터미널 제어 문자열. 글자 모양(색)은 지우고, 같은 줄 안의 이동(C 앞으로, G 칸 번호로)은 Ink가 낱말 사이에 쓰므로 빈칸으로,
   * 그 밖의 커서 이동은 줄바꿈으로 바꿔 다시 그린 화면이 붙지 않게 한다 (claude 2.1.318의 실제 화면으로 확인)
   */
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자열을 지우려는 식이다
  private static readonly CSI = /\x1b\[[0-?]*[ -/]*([@-~])/g;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자열을 지우려는 식이다
  private static readonly OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자열을 지우려는 식이다
  private static readonly ESC = /\x1b[@-Z\\-_]/g;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자열을 지우려는 식이다
  private static readonly CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

  private static readonly CSI_AS: Readonly<Record<string, string>> = { m: '', C: ' ', G: ' ' };

  /** 화면은 이만큼만 둔다. 로그인 화면은 몇 KB라 넘치면 이상한 출력이다 */
  private static readonly MAX = 256 * 1024;

  private raw = '';

  add(chunk: string): void {
    this.raw = (this.raw + chunk).slice(-SigninScreen.MAX);
  }

  /** 제어 문자열을 뺀 글. 줄은 \n으로만 나눈다 */
  get text(): string {
    return this.raw
      .replace(SigninScreen.OSC, '')
      .replace(SigninScreen.CSI, (_all, final: string) => SigninScreen.CSI_AS[final] ?? '\n')
      .replace(SigninScreen.ESC, '\n')
      .replace(/\r\n?/g, '\n')
      .replace(SigninScreen.CONTROL, '');
  }
}
