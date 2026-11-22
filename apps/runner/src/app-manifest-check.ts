// 앱의 선언서 cairn.json의 모양 검사 (스토어 9.2 · 9.13 · 12.1). 서버의 AppManifest와 같은 규칙이다:
// 그리는 법(render) · 바깥 주소(hosts) · 회원(members) · 브라우저 권한(permissions) · 고정 화면의 테마(theme) · 표(tables).
// 서버가 버전을 쌓을 때 다시 보지만, 러너가 먼저 보고 AI에게 한 번 더 맡긴다 (검증 고리 V).
// 서버와 달리 앞 버전과 견주지 않는다 (칸의 타입 바꾸기는 서버가 거절하고 그 까닭이 알림으로 간다).
// biome-ignore lint/complexity/noStaticOnlyClass: 규칙과 그 한도를 한 이름 아래에 둔다
export class AppManifestCheck {
  static readonly FILE = 'cairn.json';
  static readonly STATIC = 'static';
  static readonly HOSTS_MAX = 10;
  static readonly TABLES_MAX = 20;
  static readonly COLUMNS_MAX = 30;
  static readonly PERMISSIONS: readonly string[] = ['microphone', 'camera', 'geolocation'];
  static readonly TYPES: readonly string[] = ['text', 'int', 'number', 'bool', 'time', 'json'];
  static readonly READS: readonly string[] = ['anyone', 'member', 'owner', 'admin'];
  static readonly WRITES: readonly string[] = ['member', 'owner', 'admin'];
  /** Cairn이 모든 표에 붙이는 칸 */
  static readonly BUILT_IN: readonly string[] = ['id', 'owner', 'created_at', 'updated_at'];
  private static readonly BY_MEMBER: readonly string[] = ['member', 'owner'];
  private static readonly COMMUNITY = 'community';
  private static readonly NAME = /^[a-z][a-z0-9_]{0,39}$/;
  private static readonly COLOR = /^#[0-9a-f]{6}$/i;
  private static readonly LOGO = /^(?!\.)[^/\\\p{Cc}]{1,120}$/u;
  private static readonly HOST =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

  /** cairn.json이 정적 앱이라고 하는가 ("render": "static"). 읽을 수 없으면 템플릿 앱으로 본다 */
  static isStatic(text: string | null): boolean {
    if (text === null) return false;
    try {
      const parsed = JSON.parse(text) as { render?: unknown } | null;
      return parsed?.render === AppManifestCheck.STATIC;
    } catch {
      return false;
    }
  }

  /** 선언서의 문제들. kind: 앱의 종류 (커뮤니티 앱은 늘 회원이 있다). names: 묶음의 파일 이름 (로고가 있는지) */
  static problems(text: string | null, kind: string, names: ReadonlySet<string>): string[] {
    const file = AppManifestCheck.FILE;
    if (text === null) return [`${file}을 읽지 못했어요 (16KB까지)`];
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [`${file}이 JSON이 아니에요`];
    }
    if (!AppManifestCheck.isObject(parsed)) return [`${file}은 객체여야 해요`];
    const { cairn, hosts = [], render = 'template', members, permissions = [] } = parsed;
    const problems: string[] = [];
    if (cairn !== undefined && cairn !== 1) problems.push('데이터 약속(cairn)은 1이에요');
    if (render !== 'template' && render !== AppManifestCheck.STATIC)
      problems.push('그리는 법(render)은 template · static 중 하나예요');
    if (!Array.isArray(hosts) || hosts.length > AppManifestCheck.HOSTS_MAX)
      problems.push(`바깥 주소(hosts)는 ${AppManifestCheck.HOSTS_MAX}개까지의 목록이에요`);
    else
      for (const host of hosts)
        if (typeof host !== 'string' || !AppManifestCheck.HOST.test(host))
          problems.push(
            `바깥 주소는 정확한 호스트 이름만 (와일드카드 · IP · 포트 없이): ${String(host)}`,
          );
    if (members !== undefined && typeof members !== 'boolean')
      problems.push('회원(members)은 true · false로 적어요');
    const known = AppManifestCheck.PERMISSIONS;
    if (!Array.isArray(permissions) || permissions.some((p) => !known.includes(p as string)))
      problems.push(`권한(permissions)은 ${known.join(' · ')} 가운데서 적어요`);
    problems.push(...AppManifestCheck.themeProblems(parsed.theme, names));
    const withMembers = members === true || kind === AppManifestCheck.COMMUNITY;
    problems.push(...AppManifestCheck.tableProblems(parsed.tables ?? {}, withMembers));
    return problems;
  }

  private static themeProblems(theme: unknown, names: ReadonlySet<string>): string[] {
    if (theme === undefined || theme === null) return [];
    if (!AppManifestCheck.isObject(theme)) return ['테마(theme)는 객체로 적어요'];
    const problems: string[] = [];
    for (const key of ['accent', 'background', 'text']) {
      const value = theme[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string' || !AppManifestCheck.COLOR.test(value))
        problems.push(`테마의 색(${key})은 #rrggbb로 적어요`);
    }
    const logo = theme.logo ?? null;
    if (logo === null) return problems;
    if (typeof logo !== 'string' || !AppManifestCheck.LOGO.test(logo))
      problems.push('테마의 로고(logo)는 묶음 바로 아래의 파일 이름으로 적어요');
    else if (!names.has(logo)) problems.push(`테마의 로고 파일이 묶음에 없어요: ${logo}`);
    return problems;
  }

  private static tableProblems(tables: unknown, withMembers: boolean): string[] {
    if (!AppManifestCheck.isObject(tables)) return ['표(tables)는 이름 → 선언의 객체로 적어요'];
    const entries = Object.entries(tables);
    if (entries.length > AppManifestCheck.TABLES_MAX)
      return [`표는 ${AppManifestCheck.TABLES_MAX}개까지예요`];
    const problems: string[] = [];
    for (const [name, spec] of entries) {
      if (!AppManifestCheck.NAME.test(name)) {
        problems.push(`표 이름은 영문 소문자로 시작하는 소문자 · 숫자 · _ 40자까지예요: ${name}`);
        continue;
      }
      if (!AppManifestCheck.isObject(spec)) {
        problems.push(`표 ${name}의 선언은 객체로 적어요`);
        continue;
      }
      problems.push(...AppManifestCheck.columnProblems(name, spec.columns));
      const { read, write } = spec;
      if (typeof read !== 'string' || !AppManifestCheck.READS.includes(read))
        problems.push(
          `표 ${name}의 읽기 규칙(read)은 ${AppManifestCheck.READS.join(' · ')} 중 하나예요`,
        );
      if (typeof write !== 'string' || !AppManifestCheck.WRITES.includes(write))
        problems.push(
          `표 ${name}의 쓰기 규칙(write)은 ${AppManifestCheck.WRITES.join(' · ')} 중 하나예요`,
        );
      const byMember = [read, write].some((rule) =>
        AppManifestCheck.BY_MEMBER.includes(rule as string),
      );
      if (byMember && !withMembers)
        problems.push(
          `표 ${name}의 규칙(member · owner)은 회원이 있는 앱에서만 써요 ("members": true)`,
        );
    }
    return problems;
  }

  private static columnProblems(table: string, columns: unknown): string[] {
    if (!AppManifestCheck.isObject(columns))
      return [`표 ${table}의 칸(columns)은 이름 → 타입의 객체로 적어요`];
    const listed = Object.entries(columns);
    if (listed.length === 0 || listed.length > AppManifestCheck.COLUMNS_MAX)
      return [`표 ${table}의 칸은 1~${AppManifestCheck.COLUMNS_MAX}개예요`];
    const problems: string[] = [];
    for (const [column, type] of listed) {
      if (!AppManifestCheck.NAME.test(column) || AppManifestCheck.BUILT_IN.includes(column))
        problems.push(
          `쓸 수 없는 칸 이름이에요: ${table}.${column} (${AppManifestCheck.BUILT_IN.join(' · ')}는 Cairn이 붙여요)`,
        );
      else if (typeof type !== 'string' || !AppManifestCheck.TYPES.includes(type))
        problems.push(
          `칸의 타입은 ${AppManifestCheck.TYPES.join(' · ')} 중 하나예요: ${table}.${column}`,
        );
    }
    return problems;
  }

  private static isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
}
