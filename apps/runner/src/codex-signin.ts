import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildExit } from './ai-process';
import type { EngineSignin, SigninPrompt } from './engine-adapter';

// codex login --device-auth: 주소와 코드를 알린다 → 주인이 주소에서 코드를 넣는다 → CLI가 auth.json을 쓴다.
// 정해진 모양의 값만 꺼낸다. 서버도 같은 모양을 한 번 더 본다 (EngineLogin).
// 읽는 규칙은 Paperclip이 실제 CLI 화면으로 확인한 것을 따른다 (device-login-parse, MIT).
export class CodexSignin implements EngineSignin {
  private static readonly URL = /https:\/\/auth\.openai\.com\/codex\/device(?=\s)/;
  private static readonly MARK = /one-time code/i;
  private static readonly CODE = /(?:^|\s)([A-Za-z0-9]{4}-[A-Za-z0-9]{5})(?=\s)/;
  private static readonly AUTH_JSON_MAX = 64 * 1024;

  readonly flow = 'device_code';
  readonly args: readonly string[] = ['login', '--device-auth'];

  /** 열쇠고리가 있는 컴퓨터에서도 auth.json으로 남기게 (러너가 읽어 서버에 넘긴다) */
  async prepare(configDir: string): Promise<void> {
    await writeFile(join(configDir, 'config.toml'), 'cli_auth_credentials_store = "file"\n', {
      mode: 0o600,
    });
  }

  env(configDir: string): Readonly<Record<string, string>> {
    return { CODEX_HOME: configDir };
  }

  /** 주소와 "one-time code" 다음에 오는 XXXX-XXXXX. 코드가 오기 전에는 주소도 알리지 않는다 */
  read(screenText: string): SigninPrompt | null {
    const url = CodexSignin.URL.exec(screenText)?.[0];
    const userCode = CodexSignin.userCodeIn(screenText);
    return url === undefined || userCode === null ? null : { url, userCode };
  }

  /** 잘 끝난 뒤의 auth.json */
  async credential(
    _screenText: string,
    configDir: string,
    exitedOk: boolean,
  ): Promise<string | null> {
    if (!exitedOk) return null;
    try {
      const text = await readFile(join(configDir, 'auth.json'), 'utf8');
      return text.length > 0 && text.length <= CodexSignin.AUTH_JSON_MAX ? text : null;
    } catch {
      return null;
    }
  }

  failure(exit: ChildExit): string | null {
    return exit.code === 0 ? 'Codex가 auth.json을 남기지 않았어요' : null;
  }

  private static userCodeIn(text: string): string | null {
    const mark = CodexSignin.MARK.exec(text);
    if (!mark) return null;
    return CodexSignin.CODE.exec(text.slice(mark.index + mark[0].length))?.[1] ?? null;
  }
}
