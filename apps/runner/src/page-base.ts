import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Json } from './json';

/** 페이지의 파일 하나. 글 파일이면 내용(text)이 오고, 그림 같은 파일은 이름만 온다 */
class PageBaseFile {
  constructor(
    readonly name: string,
    readonly text: string | null,
  ) {}
}

// 고칠 페이지의 가장 새 판 (blog page_base, 2차 5단계 자라는 페이지). 페이지를 가리키는 만들기 일에만 있다.
// MakeStage가 글 파일을 inputs/page/에 두고, 지시문 틀 make에 판 번호 · 방향 · 파일 목록을 채운다.
// AI는 바뀐 파일만 내면 된다: 서버가 이 판 위에 같은 이름을 덮어 새 판을 만든다 (내지 않은 그림은 그대로 남는다).
export class PageBase {
  /** 서버가 이미 걸렀지만 디스크에 쓰기 전에 다시 본다: 폴더 구분 · 숨김 · 제어 문자 없는 120자까지 */
  private static readonly NAME = /^(?!\.)[^/\\\p{Cc}]{1,120}$/u;
  static readonly DIR = 'page';

  private constructor(
    readonly pageId: string,
    readonly title: string,
    /** 관리자가 정한 이 페이지의 쓰임 (빈 값이면 없음) */
    readonly direction: string,
    /** 고칠 판 번호 */
    readonly seq: number,
    readonly files: readonly PageBaseFile[],
  ) {}

  /** page_base의 답. 고칠 페이지가 없으면(처음 만드는 페이지) null */
  static from(body: Json): PageBase | null {
    const pageId = body.optionalText('page_id');
    if (pageId === null) return null;
    const files = body
      .list('files')
      .map((f) => new PageBaseFile(f.text('name'), f.optionalText('text')))
      .filter((f) => PageBase.NAME.test(f.name));
    return new PageBase(
      pageId,
      body.text('title'),
      body.text('direction'),
      body.number('seq'),
      files,
    );
  }

  /** 글 파일을 dir/page/에 쓴다 (러너만, 600. handOver가 agent에게 넘긴다). 쓴 폴더를 돌려준다 */
  async writeTo(dir: string): Promise<string> {
    const into = join(dir, PageBase.DIR);
    await mkdir(into, { mode: 0o700 });
    for (const f of this.files)
      if (f.text !== null) await writeFile(join(into, f.name), f.text, { flag: 'wx', mode: 0o600 });
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
}
