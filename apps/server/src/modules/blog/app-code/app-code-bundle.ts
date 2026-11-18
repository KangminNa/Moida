import { RuleViolation } from '../../platform';
import { type PageFileEntry, PageFiles } from '../page/page-files';

// 앱 코드 버전 하나의 파일 묶음 (스토어 1-6, docs/스토어.md 9.2). 파일 규칙(폴더 없는 이름 · 100개 · index.html · 형식)은
// 페이지와 같아 PageFiles를 그대로 쓰고, 앱 코드만의 규칙을 더한다: 크기 한도와 cairn.json(바깥 주소 목록).
// 템플릿(.html)은 웹이 Mustache로 채워 그린다. 코드는 우리 서버에서 실행되지 않는다.
export class AppCodeBundle {
  /** 묶음의 설정 파일. 없으면 바깥 주소 없음 */
  static readonly MANIFEST = 'cairn.json';
  /** 버전 하나의 크기 합 · 템플릿(.html)의 크기 합 */
  static readonly BYTES_MAX = 20 * 1024 * 1024;
  static readonly TEMPLATE_BYTES_MAX = 1024 * 1024;
  static readonly MANIFEST_BYTES_MAX = 16 * 1024;
  static readonly HOSTS_MAX = 10;
  /** 데이터 약속의 버전 (cairn.json의 cairn). 지금은 1뿐 */
  static readonly CONTRACT = 1;
  private static readonly TEMPLATE = /\.html$/i;
  /** 정확한 호스트 이름만: 소문자 글자 · 숫자 · 하이픈 마디 둘 이상, 와일드카드 · IP · 포트 없음 */
  private static readonly HOST =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

  private constructor(
    readonly files: PageFiles,
    readonly hosts: readonly string[],
  ) {}

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
    const templates = entries
      .filter((f) => AppCodeBundle.isTemplate(f.name))
      .reduce((sum, f) => sum + f.sizeBytes, 0);
    if (templates > AppCodeBundle.TEMPLATE_BYTES_MAX)
      throw new RuleViolation(
        `템플릿(.html)은 합쳐 ${AppCodeBundle.mb(AppCodeBundle.TEMPLATE_BYTES_MAX)}까지예요`,
      );
    const listed = files.find(AppCodeBundle.MANIFEST);
    if (listed !== null && manifest === null)
      throw new RuleViolation(`${AppCodeBundle.MANIFEST}을 읽을 수 없어요`);
    return new AppCodeBundle(files, listed === null ? [] : AppCodeBundle.hostsOf(manifest ?? ''));
  }

  /** 웹이 템플릿으로 채우는 파일인가 */
  static isTemplate(name: string): boolean {
    return AppCodeBundle.TEMPLATE.test(name);
  }

  /** cairn.json의 바깥 주소 목록. 모양이 틀리면 RuleViolation */
  static hostsOf(manifest: string): readonly string[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifest);
    } catch {
      throw new RuleViolation(`${AppCodeBundle.MANIFEST}이 JSON이 아니에요`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new RuleViolation(`${AppCodeBundle.MANIFEST}은 객체여야 해요`);
    const { cairn, hosts = [] } = parsed as { cairn?: unknown; hosts?: unknown };
    if (cairn !== undefined && cairn !== AppCodeBundle.CONTRACT)
      throw new RuleViolation(`데이터 약속(cairn)은 ${AppCodeBundle.CONTRACT}이에요`);
    if (!Array.isArray(hosts) || hosts.length > AppCodeBundle.HOSTS_MAX)
      throw new RuleViolation(`바깥 주소(hosts)는 ${AppCodeBundle.HOSTS_MAX}개까지의 목록이에요`);
    for (const host of hosts)
      if (typeof host !== 'string' || !AppCodeBundle.HOST.test(host))
        throw new RuleViolation(
          `바깥 주소는 정확한 호스트 이름만 적어요 (와일드카드 · IP · 포트 없이): ${String(host)}`,
        );
    return [...new Set(hosts as string[])];
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
