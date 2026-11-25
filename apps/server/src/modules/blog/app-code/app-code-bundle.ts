import { RuleViolation } from '../../platform';
import { type PageFileEntry, PageFiles } from '../page/page-files';
import { type AppCodeRender, AppManifest } from './app-manifest';

// 앱 코드 버전 하나의 파일 묶음 (스토어 1-6, docs/스토어.md 9.2). 파일 규칙(폴더 없는 이름 · 100개 · index.html · 형식)은
// 페이지와 같아 PageFiles를 그대로 쓰고, 앱 코드만의 규칙을 더한다: 크기 한도와 cairn.json(바깥 주소 목록).
// 템플릿(.html)은 웹이 Mustache로 채워 그린다. 코드는 우리 서버에서 실행되지 않는다.
// 정적 앱 (스토어 9.13, 2026-11-21 사용자 결정 "템플릿 없는 자유로운 앱"): cairn.json에 "render": "static"이면 템플릿을 거치지 않고
// 파일 그대로 내보낸다. 폴더가 든 이름(`assets/app.js`) · 파일 500개까지, 어느 종류의 앱이든 (2026-11-25 A4). 버전 · 확인 대기 · 격리는 같다.
export class AppCodeBundle {
  /** 묶음의 설정 파일. 없으면 바깥 주소 없음 */
  static readonly MANIFEST = 'cairn.json';
  /** 앱의 디자인 문서 (2026-11-25, 스킬 cairn-make의 design-research.md): 일꾼이 읽고 고치는 파일이라 방문자에게 내보내지 않는다 */
  static readonly DESIGN = 'design.md';
  /** 버전 하나의 크기 합 · 템플릿(.html)의 크기 합 */
  static readonly BYTES_MAX = 20 * 1024 * 1024;
  static readonly TEMPLATE_BYTES_MAX = 1024 * 1024;
  static readonly MANIFEST_BYTES_MAX = 16 * 1024;
  private static readonly TEMPLATE = /\.html$/i;

  /** 그리는 법 (cairn.json의 render): 템플릿을 채우거나(기본), 파일 그대로(정적 앱, 스토어 9.13) */
  static readonly TEMPLATED: AppCodeRender = AppManifest.TEMPLATED;
  static readonly STATIC: AppCodeRender = AppManifest.STATIC;
  private static readonly COMMUNITY = 'community';
  private constructor(
    readonly files: PageFiles,
    /** 선언서 (cairn.json. 없으면 AppManifest.NONE) */
    readonly manifest: AppManifest,
  ) {}

  get hosts(): readonly string[] {
    return this.manifest.hosts;
  }

  get render(): AppCodeRender {
    return this.manifest.render;
  }

  /** 앱 코드의 파일 목록: 폴더가 든 이름까지 읽는다 (폴더를 써도 되는지는 of가 render로 본다) */
  static files(raw: unknown): PageFiles {
    return PageFiles.of(raw, true);
  }

  /** 이 묶음을 그 종류의 앱에 둘 수 있는가. 아니면 RuleViolation */
  assertFits(kind: string): void {
    this.manifest.assertFits(kind, AppCodeBundle.COMMUNITY);
  }

  /**
   * 파일 목록과 cairn.json의 글(있으면)에서. 규칙에 맞지 않으면 RuleViolation.
   * manifest: cairn.json의 내용. 파일이 있는데 null이면 읽을 수 없는 크기라 거절한다
   */
  static of(files: PageFiles, manifest: string | null): AppCodeBundle {
    const entries = files.toJSON();
    const bytes = entries.reduce((sum, f) => sum + f.sizeBytes, 0);
    if (bytes > AppCodeBundle.BYTES_MAX)
      throw new RuleViolation(
        `앱 코드는 합쳐 ${AppCodeBundle.mb(AppCodeBundle.BYTES_MAX)}까지예요`,
      );
    const listed = files.find(AppCodeBundle.MANIFEST);
    if (listed !== null && manifest === null)
      throw new RuleViolation(`${AppCodeBundle.MANIFEST}을 읽을 수 없어요`);
    const declared = listed === null ? AppManifest.NONE : AppManifest.of(manifest ?? '');
    const { render } = declared;
    const logo = declared.theme?.logo ?? null;
    if (logo !== null && files.find(logo) === null)
      throw new RuleViolation(`테마의 로고 파일이 묶음에 없어요: ${logo}`);
    const pages = entries.filter((f) => AppCodeBundle.isTemplate(f.name));
    if (render === AppCodeBundle.STATIC) {
      // 정적 앱: HTML은 웹이 주소 기준 · 데이터를 넣어 보내므로 파일 하나의 크기만 본다
      const big = pages.find((f) => f.sizeBytes > AppCodeBundle.TEMPLATE_BYTES_MAX);
      if (big)
        throw new RuleViolation(
          `HTML 파일 하나는 ${AppCodeBundle.mb(AppCodeBundle.TEMPLATE_BYTES_MAX)}까지예요: ${big.name}`,
        );
      return new AppCodeBundle(files, declared);
    }
    const folder = entries.find((f) => PageFiles.isNested(f.name));
    if (folder)
      throw new RuleViolation(
        `폴더 없이 파일만 넣어 주세요: ${folder.name} (폴더를 쓰려면 ${AppCodeBundle.MANIFEST}에 "render": "static")`,
      );
    if (entries.length > PageFiles.MAX)
      throw new RuleViolation(`앱 코드의 파일은 ${PageFiles.MAX}개까지예요`);
    if (pages.reduce((sum, f) => sum + f.sizeBytes, 0) > AppCodeBundle.TEMPLATE_BYTES_MAX)
      throw new RuleViolation(
        `템플릿(.html)은 합쳐 ${AppCodeBundle.mb(AppCodeBundle.TEMPLATE_BYTES_MAX)}까지예요`,
      );
    return new AppCodeBundle(files, declared);
  }

  /** 웹이 템플릿으로 채우는 파일인가 */
  static isTemplate(name: string): boolean {
    return AppCodeBundle.TEMPLATE.test(name);
  }

  /** cairn.json의 글 → 선언서. 모양이 틀리면 RuleViolation */
  static manifestOf(manifest: string): AppManifest {
    return AppManifest.of(manifest);
  }

  /** 두 버전의 파일 비교 (이름 · 내용 해시). 앞이 시작 코드여도 같은 모양이다 */
  static diff(
    before: PageFiles,
    after: PageFiles,
  ): { added: string[]; changed: string[]; removed: string[] } {
    const old = new Map<string, PageFileEntry>(before.toJSON().map((f) => [f.name, f]));
    const now = after.toJSON();
    return {
      added: now.filter((f) => !old.has(f.name)).map((f) => f.name),
      changed: now
        .filter((f) => old.has(f.name) && old.get(f.name)?.blobHash !== f.blobHash)
        .map((f) => f.name),
      removed: [...old.keys()].filter((name) => after.find(name) === null),
    };
  }

  private static mb(bytes: number): string {
    return `${bytes / 1024 / 1024}MB`;
  }
}
