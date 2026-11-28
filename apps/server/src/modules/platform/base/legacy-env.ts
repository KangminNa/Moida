// 옛 이름의 환경 변수 받기 (2026-11-28, 이름 cairn → moida): 배포의 .env에 CAIRN_X만 있으면 MOIDA_X로 옮겨 둔다.
// 새 이름이 먼저다 (둘 다 있으면 CAIRN_X는 보지 않는다). 옮긴 이름은 시작할 때 한 번 알린다.
// 서버 · 일꾼 · 명령줄이 시작하자마자 부른다 (MoidaApp): 그 뒤의 코드는 새 이름만 읽는다.
// 배포의 .env를 새 이름으로 바꾸면 이 길은 쓰이지 않고, 옛 이름을 받는 기간이 끝나면 이 파일을 지운다
// biome-ignore lint/complexity/noStaticOnlyClass: 시작할 때 한 번 하는 옮기기 한 곳
export class LegacyEnv {
  static readonly OLD = 'CAIRN_';
  static readonly NEW = 'MOIDA_';
  private static warned = false;

  /** 옮긴 새 이름들. env를 바꾼다 */
  static adopt(
    env: Record<string, string | undefined> = process.env,
    warn: (text: string) => void = (text) => console.warn(text),
  ): string[] {
    const moved: string[] = [];
    for (const [name, value] of Object.entries(env)) {
      if (!name.startsWith(LegacyEnv.OLD) || value === undefined) continue;
      const next = LegacyEnv.NEW + name.slice(LegacyEnv.OLD.length);
      if (env[next] !== undefined) continue;
      env[next] = value;
      moved.push(next);
    }
    if (moved.length > 0 && !LegacyEnv.warned) {
      LegacyEnv.warned = true;
      warn(
        `옛 이름의 환경 변수를 읽었어요 (${moved.map((n) => `CAIRN_${n.slice(LegacyEnv.NEW.length)}`).join(', ')}). .env에서 MOIDA_로 바꿔 주세요`,
      );
    }
    return moved;
  }
}
