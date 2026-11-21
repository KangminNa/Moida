import { RuleViolation } from '../../platform';

/** 판의 파일 하나 (blog.page_revisions.files의 원소). 파일 본문은 platform.blobs에 있다 */
export interface PageFileEntry {
  name: string;
  blobHash: string;
  mime: string;
  sizeBytes: number;
}

// 판 하나의 파일 묶음. 한 폴더에 나란히 있는 파일들이고(이름에 경로가 없다), 들어가는 문은 index.html이다.
// 앱 코드는 같은 모양에 폴더가 든 이름까지 받는다 (nested: 정적 앱 `assets/app.js`, 스토어 9.13. 템플릿 앱인지는 AppCodeBundle이 본다).
// 보낼 때의 형식은 이름의 확장자로 정한다: 만든 쪽이 적은 형식을 믿지 않고, 모르는 확장자는 내려받는 파일로 둔다.
export class PageFiles {
  static readonly ENTRY = 'index.html';
  static readonly MAX = 100;
  /** 폴더가 있는 묶음(정적 앱 코드, 스토어 9.13)의 한도: 파일 수 · 폴더 깊이 · 경로 길이 */
  static readonly NESTED_MAX = 500;
  private static readonly DEPTH_MAX = 6;
  private static readonly PATH_MAX = 300;
  /** 경로 없는 이름 (제어 문자 같은 것은 결과물을 받을 때 task가 이미 걸렀다) */
  private static readonly NAME = /^[^/\\]{1,120}$/;
  private static readonly HASH = /^[0-9a-f]{64}$/;
  private static readonly OCTET = 'application/octet-stream';
  private static readonly TYPES: Readonly<Record<string, string>> = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    md: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    pdf: 'application/pdf',
  };

  private constructor(private readonly entries: readonly PageFileEntry[]) {}

  /**
   * 받은 목록(이벤트나 표의 files)에서. 모양이 틀리거나 index.html이 없으면 RuleViolation.
   * nested: 폴더가 있는 이름(`assets/app.js`)도 받는다 (앱 코드. 페이지는 늘 한 폴더다)
   */
  static of(raw: unknown, nested = false): PageFiles {
    if (!Array.isArray(raw) || raw.length === 0) throw new RuleViolation('페이지에 파일이 없어요');
    const max = nested ? PageFiles.NESTED_MAX : PageFiles.MAX;
    if (raw.length > max) throw new RuleViolation(`페이지의 파일은 ${max}개까지예요`);
    const entries = raw.map((item) => PageFiles.entry(item, nested));
    const names = new Set(entries.map((e) => e.name));
    if (names.size !== entries.length) throw new RuleViolation('이름이 같은 파일이 있어요');
    if (!names.has(PageFiles.ENTRY)) throw new RuleViolation(`${PageFiles.ENTRY}이 없어요`);
    return new PageFiles(entries);
  }

  /** 이 판의 파일 위에 새 파일들(받은 목록)을 얹은 목록: 이름이 같으면 새 것 (자라는 페이지의 새 판) */
  overlay(fresh: unknown): readonly unknown[] {
    const added = Array.isArray(fresh) ? fresh : [];
    const names = new Set(added.map((f) => (f as { name?: unknown } | null)?.name));
    return [...this.entries.filter((e) => !names.has(e.name)), ...added];
  }

  /** 이름으로 찾는다. 없으면 null */
  find(name: string): PageFileEntry | null {
    return this.entries.find((e) => e.name === name) ?? null;
  }

  /** 그 이름을 보낼 때의 형식 */
  static typeOf(name: string): string {
    const dot = name.lastIndexOf('.');
    const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
    return PageFiles.TYPES[extension] ?? PageFiles.OCTET;
  }

  /** 표에 넣을 모양 */
  toJSON(): readonly PageFileEntry[] {
    return this.entries;
  }

  /** 폴더가 든 이름인가 */
  static isNested(name: string): boolean {
    return name.includes('/');
  }

  /** 이름 규칙: 마디마다 경로 없는 이름이고 숨김(.)이 아니다. nested가 아니면 마디는 하나 */
  private static named(name: unknown, nested: boolean): name is string {
    if (typeof name !== 'string' || name.length > PageFiles.PATH_MAX) return false;
    const parts = name.split('/');
    if (parts.length > (nested ? PageFiles.DEPTH_MAX : 1)) return false;
    return parts.every((part) => PageFiles.NAME.test(part) && !part.startsWith('.'));
  }

  private static entry(raw: unknown, nested: boolean): PageFileEntry {
    const { name, blobHash, mime, sizeBytes } = (raw ?? {}) as Partial<PageFileEntry>;
    if (!PageFiles.named(name, nested))
      throw new RuleViolation(`페이지 파일의 이름이 맞지 않아요: ${String(name)}`);
    if (typeof blobHash !== 'string' || !PageFiles.HASH.test(blobHash))
      throw new RuleViolation(`${name}: 파일 해시가 맞지 않아요`);
    if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0)
      throw new RuleViolation(`${name}: 크기가 맞지 않아요`);
    return { name, blobHash, mime: typeof mime === 'string' ? mime : PageFiles.OCTET, sizeBytes };
  }
}
