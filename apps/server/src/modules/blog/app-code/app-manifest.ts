import { RuleViolation } from '../../platform';

/** 그리는 법 (cairn.json의 render): 템플릿을 채우거나(기본), 파일 그대로(정적 앱, 스토어 9.13) */
export type AppCodeRender = 'template' | 'static';

/** 선언한 표 하나 (cairn.json의 tables, 스토어 12.1): 칸 이름 → 타입, 읽기 · 쓰기 규칙 */
export interface AppTableSpec {
  columns: Readonly<Record<string, string>>;
  read: string;
  write: string;
}

/** 고정 화면에 입히는 테마 (cairn.json의 theme): 색은 #rrggbb, 로고는 묶음의 파일 이름 */
export interface AppThemeSpec {
  accent: string | null;
  background: string | null;
  text: string | null;
  logo: string | null;
}

// 앱의 선언서 cairn.json (스토어 9.2 · 9.13 · 12.1). 앱이 Cairn에게 바라는 것을 적는 한 장이다:
// 그리는 법(render) · 바깥 주소(hosts) · 회원(members) · 브라우저 권한(permissions) · 고정 화면의 테마(theme) · 표(tables).
// 앱 코드는 SQL · 서버 코드를 갖지 않는다: 표는 여기 적은 선언으로만 생기고 community가 맞춘다 (12.4).
// 버전을 쌓을 때 모양을 검사하고, 보이는 버전의 것은 정리한 모양(toJSON)으로 blog.apps.code_manifest에 둔다.
export class AppManifest {
  static readonly FILE = 'cairn.json';
  /** 데이터 약속의 버전 (cairn). 지금은 1뿐 */
  static readonly CONTRACT = 1;
  static readonly HOSTS_MAX = 10;
  static readonly TABLES_MAX = 20;
  static readonly COLUMNS_MAX = 30;
  static readonly TEMPLATED: AppCodeRender = 'template';
  static readonly STATIC: AppCodeRender = 'static';
  static readonly PERMISSIONS: readonly string[] = ['microphone', 'camera', 'geolocation'];
  static readonly TYPES: readonly string[] = ['text', 'int', 'number', 'bool', 'time', 'json'];
  static readonly READS: readonly string[] = ['anyone', 'member', 'owner', 'admin'];
  static readonly WRITES: readonly string[] = ['member', 'owner', 'admin'];
  /** 회원이 있어야 뜻이 있는 규칙 */
  private static readonly BY_MEMBER: readonly string[] = ['member', 'owner'];
  /** Cairn이 모든 표에 붙이는 칸 (선언하지 않는다) */
  static readonly BUILT_IN: readonly string[] = ['id', 'owner', 'created_at', 'updated_at'];
  /** 표 · 칸 이름: SQL의 이름이 된다. 영문 소문자로 시작하는 소문자 · 숫자 · _ 40자까지 */
  private static readonly NAME = /^[a-z][a-z0-9_]{0,39}$/;
  private static readonly COLOR = /^#[0-9a-f]{6}$/i;
  private static readonly LOGO = /^(?!\.)[^/\\\p{Cc}]{1,120}$/u;
  /** 정확한 호스트 이름만: 소문자 글자 · 숫자 · 하이픈 마디 둘 이상, 와일드카드 · IP · 포트 없음 */
  private static readonly HOST =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  /** cairn.json이 없는 묶음: 템플릿 앱, 바깥 주소 · 회원 · 표 없음 */
  static readonly NONE = new AppManifest([], AppManifest.TEMPLATED, false, [], null, {});

  private constructor(
    readonly hosts: readonly string[],
    readonly render: AppCodeRender,
    readonly members: boolean,
    readonly permissions: readonly string[],
    readonly theme: Readonly<AppThemeSpec> | null,
    readonly tables: Readonly<Record<string, AppTableSpec>>,
  ) {}

  /** cairn.json의 글에서. 모양이 틀리면 RuleViolation */
  static of(text: string): AppManifest {
    const file = AppManifest.FILE;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new RuleViolation(`${file}이 JSON이 아니에요`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new RuleViolation(`${file}은 객체여야 해요`);
    const raw = parsed as Record<string, unknown>;
    const render = raw.render ?? AppManifest.TEMPLATED;
    if (render !== AppManifest.TEMPLATED && render !== AppManifest.STATIC)
      throw new RuleViolation(
        `그리는 법(render)은 ${AppManifest.TEMPLATED} · ${AppManifest.STATIC} 중 하나예요`,
      );
    if (raw.cairn !== undefined && raw.cairn !== AppManifest.CONTRACT)
      throw new RuleViolation(`데이터 약속(cairn)은 ${AppManifest.CONTRACT}이에요`);
    if (raw.members !== undefined && typeof raw.members !== 'boolean')
      throw new RuleViolation('회원(members)은 true · false로 적어요');
    const members = raw.members === true;
    return new AppManifest(
      AppManifest.hostsOf(raw.hosts ?? []),
      render as AppCodeRender,
      members,
      AppManifest.permissionsOf(raw.permissions ?? []),
      AppManifest.themeOf(raw.theme),
      AppManifest.tablesOf(raw.tables ?? {}),
    );
  }

  /** blog.apps.code_manifest에 둔 값에서 (쌓을 때 검사한 값이라 틀리면 없는 것으로 읽는다) */
  static stored(raw: unknown): AppManifest {
    try {
      return AppManifest.of(JSON.stringify(raw ?? {}));
    } catch {
      return AppManifest.NONE;
    }
  }

  /**
   * 이 선언을 그 종류의 앱에 둘 수 있는가. 회원이 쓰는 규칙(member · owner)은 회원을 받는 앱에서만
   * (커뮤니티 앱은 늘 회원이 있다). 아니면 RuleViolation
   */
  assertFits(kind: string, community: string): void {
    if (this.members || kind === community) return;
    for (const [name, spec] of Object.entries(this.tables))
      if ([spec.read, spec.write].some((rule) => AppManifest.BY_MEMBER.includes(rule)))
        throw new RuleViolation(
          `표 ${name}의 규칙(member · owner)은 회원이 있는 앱에서만 써요 ("members": true)`,
        );
  }

  /** 앞 버전과 견줘 칸의 타입을 바꾸지 않았는가 (바꾸려면 새 이름으로 더한다). 아니면 RuleViolation */
  assertExtends(before: AppManifest): void {
    for (const [name, spec] of Object.entries(this.tables)) {
      const old = before.tables[name];
      if (!old) continue;
      for (const [column, type] of Object.entries(spec.columns))
        if (old.columns[column] !== undefined && old.columns[column] !== type)
          throw new RuleViolation(
            `칸의 타입은 바꿀 수 없어요: ${name}.${column} (${old.columns[column]} → ${type}). 새 이름으로 더해요`,
          );
    }
  }

  /** 정리한 모양 (apps.code_manifest · 이벤트 · 응답) */
  toJSON() {
    return {
      render: this.render,
      hosts: [...this.hosts],
      members: this.members,
      permissions: [...this.permissions],
      theme: this.theme === null ? null : { ...this.theme },
      tables: Object.fromEntries(
        Object.entries(this.tables).map(([name, t]) => [
          name,
          { columns: { ...t.columns }, read: t.read, write: t.write },
        ]),
      ),
    };
  }

  /**
   * 지도 회사의 스크립트 호스트 (2026-11-25): 앱이 지도 SDK와 키를 직접 넣지 않고 cairn.map을 쓰게 바깥 주소에 받지 않는다.
   * 키는 관리자가 지도 플러그인에 넣고, 웹이 화면마다 회사의 호스트를 연다. 목록은 plugins/map/providers.json의 sdkHosts와 같다
   * (서버는 src 밖을 가져오지 않아 옮겨 적고, app-manifest.test.ts가 그 파일과 맞춰 본다)
   */
  private static readonly MAP_HOSTS: readonly string[] = [
    'dapi.kakao.com',
    't1.daumcdn.net',
    'oapi.map.naver.com',
    'openapi.map.naver.com',
    'maps.googleapis.com',
    'maps.gstatic.com',
  ];

  private static hostsOf(hosts: unknown): readonly string[] {
    if (!Array.isArray(hosts) || hosts.length > AppManifest.HOSTS_MAX)
      throw new RuleViolation(`바깥 주소(hosts)는 ${AppManifest.HOSTS_MAX}개까지의 목록이에요`);
    for (const host of hosts)
      if (typeof host !== 'string' || !AppManifest.HOST.test(host))
        throw new RuleViolation(
          `바깥 주소는 정확한 호스트 이름만 적어요 (와일드카드 · IP · 포트 없이): ${String(host)}`,
        );
    const map = (hosts as string[]).find((h) => AppManifest.MAP_HOSTS.includes(h.toLowerCase()));
    if (map)
      throw new RuleViolation(
        `지도는 cairn.map으로 그려요 (키는 지도 플러그인에): 바깥 주소에 ${map}을 적지 않아요`,
      );
    return [...new Set(hosts as string[])];
  }

  private static permissionsOf(raw: unknown): readonly string[] {
    const known = AppManifest.PERMISSIONS;
    if (!Array.isArray(raw) || raw.some((p) => !known.includes(p)))
      throw new RuleViolation(`권한(permissions)은 ${known.join(' · ')} 가운데서 적어요`);
    return [...new Set(raw as string[])];
  }

  private static themeOf(raw: unknown): AppThemeSpec | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw))
      throw new RuleViolation('테마(theme)는 객체로 적어요');
    const theme = raw as Record<string, unknown>;
    const color = (name: string): string | null => {
      const value = theme[name];
      if (value === undefined || value === null) return null;
      if (typeof value !== 'string' || !AppManifest.COLOR.test(value))
        throw new RuleViolation(`테마의 색(${name})은 #rrggbb로 적어요`);
      return value.toLowerCase();
    };
    const logo = theme.logo ?? null;
    if (logo !== null && (typeof logo !== 'string' || !AppManifest.LOGO.test(logo)))
      throw new RuleViolation('테마의 로고(logo)는 묶음 바로 아래의 파일 이름으로 적어요');
    return {
      accent: color('accent'),
      background: color('background'),
      text: color('text'),
      logo: logo as string | null,
    };
  }

  private static tablesOf(raw: unknown): Record<string, AppTableSpec> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new RuleViolation('표(tables)는 이름 → 선언의 객체로 적어요');
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > AppManifest.TABLES_MAX)
      throw new RuleViolation(`표는 ${AppManifest.TABLES_MAX}개까지예요`);
    const tables: Record<string, AppTableSpec> = {};
    for (const [name, spec] of entries) tables[name] = AppManifest.tableOf(name, spec);
    return tables;
  }

  private static tableOf(name: string, raw: unknown): AppTableSpec {
    if (!AppManifest.NAME.test(name))
      throw new RuleViolation(
        `표 이름은 영문 소문자로 시작하는 소문자 · 숫자 · _ 40자까지예요: ${name}`,
      );
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new RuleViolation(`표 ${name}의 선언은 객체로 적어요`);
    const { columns, read, write } = raw as Record<string, unknown>;
    if (columns === null || typeof columns !== 'object' || Array.isArray(columns))
      throw new RuleViolation(`표 ${name}의 칸(columns)은 이름 → 타입의 객체로 적어요`);
    const listed = Object.entries(columns as Record<string, unknown>);
    if (listed.length === 0 || listed.length > AppManifest.COLUMNS_MAX)
      throw new RuleViolation(`표 ${name}의 칸은 1~${AppManifest.COLUMNS_MAX}개예요`);
    for (const [column, type] of listed) {
      if (!AppManifest.NAME.test(column) || AppManifest.BUILT_IN.includes(column))
        throw new RuleViolation(
          `쓸 수 없는 칸 이름이에요: ${name}.${column} (${AppManifest.BUILT_IN.join(' · ')}는 Moida가 붙여요)`,
        );
      if (typeof type !== 'string' || !AppManifest.TYPES.includes(type))
        throw new RuleViolation(
          `칸의 타입은 ${AppManifest.TYPES.join(' · ')} 중 하나예요: ${name}.${column}`,
        );
    }
    if (typeof read !== 'string' || !AppManifest.READS.includes(read))
      throw new RuleViolation(
        `표 ${name}의 읽기 규칙(read)은 ${AppManifest.READS.join(' · ')} 중 하나예요`,
      );
    if (typeof write !== 'string' || !AppManifest.WRITES.includes(write))
      throw new RuleViolation(
        `표 ${name}의 쓰기 규칙(write)은 ${AppManifest.WRITES.join(' · ')} 중 하나예요`,
      );
    return { columns: Object.fromEntries(listed) as Record<string, string>, read, write };
  }
}
