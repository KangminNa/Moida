import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Json } from './json';

/** 앱 코드의 파일 하나. 글 파일이면 내용(text)이 오고, 그림 같은 파일은 이름 · 크기만 온다 */
export class AppCodeFile {
  constructor(
    readonly name: string,
    readonly size: number,
    readonly text: string | null,
  ) {}
}

// 고칠 앱의 지금 코드 (blog app_code_base, 스토어 1-6). 앱 코드를 고치는 만들기 일(payload.appCode)에만 있다.
// MakeStage가 글 파일을 inputs/app/에 두고, 지시문 틀 make에 앱 이름 · 버전 · 파일 목록 · 바깥 주소를 채운다.
// AI는 바뀐 파일만 내면 된다: 서버가 이 코드 위에 같은 이름을 덮어 새 버전을 만든다 (내지 않은 파일은 그대로 남는다).
// 검사(AppCodeCheck)도 이 코드 위에 낸 파일을 얹은 모양을 본다.
export class AppCodeBase {
  /**
   * 서버가 이미 걸렀지만 디스크에 쓰기 전에 다시 본다: 마디마다 숨김 · 제어 문자 · 역슬래시 없는 120자까지,
   * 폴더는 정적 앱의 것이고 경로는 파일까지 여섯 마디 (스토어 9.13, 서버의 PageFiles와 같다). ".." 마디는 숨김이라 걸린다
   */
  private static readonly NAME = /^(?:(?!\.)[^/\\\p{Cc}]{1,120}\/){0,5}(?!\.)[^/\\\p{Cc}]{1,120}$/u;
  static readonly DIR = 'app';

  private constructor(
    readonly appId: string,
    readonly name: string,
    /** 앱 종류 (blog · magazine · page) */
    readonly kind: string,
    readonly slug: string,
    /** 받은 코드의 버전. 0이면 종류의 시작 코드 */
    readonly seq: number,
    readonly files: readonly AppCodeFile[],
    /** moida.json의 바깥 주소 */
    readonly hosts: readonly string[],
    /** 이 서버에서 켜진 플러그인이 moida.js에 주는 것 (플러그인 이름 → 이름들, 2026-11-28) */
    readonly library: readonly { plugin: string; provides: readonly string[] }[],
  ) {}

  /** app_code_base의 답. 고칠 앱이 없는 일이면 null */
  static from(body: Json): AppCodeBase | null {
    const appId = body.optionalText('app_id');
    if (appId === null) return null;
    const files = body
      .list('files')
      .map((f) => new AppCodeFile(f.text('name'), f.number('size'), f.optionalText('text')))
      .filter((f) => AppCodeBase.NAME.test(f.name));
    return new AppCodeBase(
      appId,
      body.text('name'),
      body.text('kind'),
      body.text('slug'),
      body.number('seq'),
      files,
      body.texts('hosts'),
      body
        .list('library')
        .map((l) => ({ plugin: l.text('plugin'), provides: l.texts('provides') }))
        .filter((l) => l.provides.length > 0),
    );
  }

  /** 글 파일을 dir/app/에 쓴다 (러너만, 600. handOver가 agent에게 넘긴다). 쓴 폴더를 돌려준다 */
  async writeTo(dir: string): Promise<string> {
    const into = join(dir, AppCodeBase.DIR);
    await mkdir(into, { mode: 0o700 });
    for (const f of this.files) {
      if (f.text === null) continue;
      const path = join(into, f.name);
      if (f.name.includes('/')) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, f.text, { flag: 'wx', mode: 0o600 });
    }
    return into;
  }

  /** 지시문에 넣을 파일 목록: 글 파일은 폴더에 있다고, 나머지는 그대로 남는다고 */
  get listing(): string {
    return this.files
      .map(
        (f) =>
          `- ${f.name}${f.text === null ? ' (그대로 남아요. 바꿀 때만 같은 이름으로 내요)' : ''}`,
      )
      .join('\n');
  }

  /** 지시문에 넣을 플러그인 라이브러리 한 줄 (예: "moida.map · <moida-place-list> (플러그인 map)"). 없으면 null */
  get libraryLine(): string | null {
    const line = this.library
      .map((l) => `${l.provides.join(' · ')} (플러그인 ${l.plugin})`)
      .join(', ');
    return line === '' ? null : line;
  }

  /** 지시문에 넣을 버전 이름 */
  get version(): string {
    return this.seq === 0 ? '시작 코드' : `버전 ${this.seq}`;
  }
}
