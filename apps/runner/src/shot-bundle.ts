import { join } from 'node:path';
import type { AgentUser, FolderEntry } from './agent-user';
import type { AppCodeBase } from './app-code-base';
import { AppCodeCheck } from './app-code-check';
import { AppManifestCheck } from './app-manifest-check';
import { DesignDocCheck } from './design-doc-check';
import type { PageBase } from './page-base';
import { ZipIndex } from './zip-index';

// 결과 화면 찍기에 올릴 묶음 (2026-11-28): 앞 버전(앱 코드 · 페이지) 위에 이번에 낸 파일을 얹은 모양. 서버가 새 버전을 만드는 것과 같다.
// 낸 파일은 agent 권한으로 읽는다 (AI가 둔 링크를 러너가 따라가지 않게). 앞 버전의 그림처럼 내용이 오지 않은 파일은 이름만 안다(known).
// 찍지 않는 경우는 까닭(skip): 템플릿으로 그리는 앱(서버가 데이터를 채워야 그려진다), 문(index.html)이 없는 앱 · 페이지.
// 페이지도 앱도 아닌 만들기 일은 낸 HTML(슬라이드 · 한 장 페이지)이 있을 때만: index.html, 없으면 이름순 첫 .html
export class ShotBundle {
  private static readonly ENTRY = 'index.html';
  /** 파일 하나 · 묶음 전체를 메모리에 드는 한도 */
  private static readonly FILE_MAX = 8 * 1024 * 1024;
  private static readonly TOTAL_MAX = 48 * 1024 * 1024;
  private static readonly SCREEN = /\.(html?|css)$/i;
  private static readonly HTML = /\.html?$/i;

  private constructor(
    readonly files: ReadonlyMap<string, Buffer>,
    readonly known: ReadonlySet<string>,
    /** 열 파일. 찍지 않으면 null */
    readonly entry: string | null,
    /** 찍지 않는 까닭 (화면이 없는 일이면 null도 entry도 null) */
    readonly skip: string | null,
    /** 이번에 화면(HTML · CSS)을 냈는가: 참고 화면과의 비교를 받는다 */
    readonly screens: boolean,
    /** 앱 코드 일인가: 비교는 design.md의 ## 비교에 (아니면 .moida/compare.md) */
    readonly app: boolean,
  ) {}

  /** 묶음 안의 디자인 문서 (앱) */
  get designDoc(): string | null {
    return this.files.get(DesignDocCheck.FILE)?.toString('utf8') ?? null;
  }

  static async gather(
    agent: AgentUser,
    dir: string,
    made: readonly FolderEntry[],
    base: { app: AppCodeBase } | { page: PageBase } | null,
  ): Promise<ShotBundle> {
    const files = new Map<string, Buffer>();
    const known = new Set<string>();
    if (base !== null)
      for (const f of 'app' in base ? base.app.files : base.page.files) {
        if (f.text === null) known.add(f.name);
        else files.set(f.name, Buffer.from(f.text, 'utf8'));
      }
    const packed =
      made.some((f) => f.name === AppCodeCheck.PACKED) && base !== null && 'app' in base;
    const names = packed
      ? await ShotBundle.unpack(agent, join(dir, AppCodeCheck.PACKED), files, known)
      : await ShotBundle.read(agent, dir, made, files, known);
    const screens = names.some((n) => ShotBundle.SCREEN.test(n));
    const app = base !== null && 'app' in base;
    const has = (name: string) => files.has(name) || known.has(name);
    if (app) {
      const manifest = AppManifestCheck.pick(
        [...files].map(([name, body]) => ({ name, text: body.toString('utf8') })),
      );
      if (!AppManifestCheck.isStatic(manifest?.text ?? null))
        return new ShotBundle(
          files,
          known,
          null,
          '템플릿으로 그리는 앱은 서버가 데이터를 채워야 그려져 찍지 않았어요',
          screens,
          app,
        );
    }
    if (base !== null)
      return has(ShotBundle.ENTRY)
        ? new ShotBundle(files, known, ShotBundle.ENTRY, null, screens, app)
        : new ShotBundle(
            files,
            known,
            null,
            `${ShotBundle.ENTRY}가 없어 찍지 않았어요`,
            screens,
            app,
          );
    const html = names.filter((n) => ShotBundle.HTML.test(n)).sort();
    const entry = html.includes(ShotBundle.ENTRY) ? ShotBundle.ENTRY : (html[0] ?? null);
    return new ShotBundle(files, known, entry, null, entry !== null && screens, app);
  }

  /** 낸 파일을 읽어 묶음에 얹는다. 읽은 이름들 */
  private static async read(
    agent: AgentUser,
    dir: string,
    made: readonly FolderEntry[],
    files: Map<string, Buffer>,
    known: Set<string>,
  ): Promise<string[]> {
    let total = 0;
    for (const { name, size } of made) {
      const fits = size <= ShotBundle.FILE_MAX && total + size <= ShotBundle.TOTAL_MAX;
      const body = fits ? await agent.readBytes(join(dir, name), ShotBundle.FILE_MAX) : null;
      if (body === null) {
        files.delete(name);
        known.add(name);
        continue;
      }
      total += body.length;
      files.set(name, body);
    }
    return made.map((f) => f.name);
  }

  /** app.zip(폴더가 든 정적 앱)이면 그 안이 묶음 전체다: 앞 버전 위에 얹지 않는다 */
  private static async unpack(
    agent: AgentUser,
    path: string,
    files: Map<string, Buffer>,
    known: Set<string>,
  ): Promise<string[]> {
    files.clear();
    known.clear();
    const bytes = await agent.readBytes(path, AppCodeCheck.BYTES_MAX);
    const zip = bytes === null ? null : ZipIndex.read(bytes);
    if (bytes === null || zip === null) return [];
    let total = 0;
    for (const entry of zip.entries) {
      const body =
        total + entry.size <= ShotBundle.TOTAL_MAX ? entry.bytes(bytes, ShotBundle.FILE_MAX) : null;
      if (body === null) known.add(entry.name);
      else {
        total += body.length;
        files.set(entry.name, body);
      }
    }
    return zip.entries.map((e) => e.name);
  }
}
