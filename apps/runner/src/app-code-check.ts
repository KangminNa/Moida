import type { AppCodeBase } from './app-code-base';
import { StageCheck } from './stage-check';

/** 검사할 파일 하나: 앞 코드의 것이거나 AI가 낸 것. text는 읽은 글(템플릿 · cairn.json)만, 못 읽었으면 null */
export class AppCodeEntry {
  constructor(
    readonly name: string,
    readonly size: number,
    readonly text: string | null,
  ) {}
}

/** 템플릿 하나를 훑은 결과: 문법 문제와 쓴 데이터 이름 */
class TemplateScan {
  readonly problems: string[] = [];
  readonly names = new Set<string>();
}

// 앱 코드를 고치는 만들기 일의 검사 (스토어 1-6c, docs/스토어.md 9.6). 앞 코드 위에 AI가 낸 파일을 얹은 모양을 본다:
//   묶음 규칙 (서버의 AppCodeBundle과 같은 한도: 100개 · 합 20MB · 템플릿 합 1MB · index.html) · cairn.json
//   템플릿 문법 (Mustache: 여닫는 짝 · 없는 조각 · {{{ }}}는 html 값에만 · 구분자 바꾸기 금지)
//   데이터 이름 (약속 cairn: 1에 없는 이름은 빈 칸으로 그려진다)
// 떨어지면 JobRun이 AI에게 한 번 더 맡긴다 (검증 고리 V). 그래도 묶음 · 문법이 틀리면 MakeStage가 일을 실패로 끝낸다:
// 서버는 Mustache를 읽지 않아 틀린 템플릿도 버전이 되고, 비공개 앱은 바로 방문자(관리자)에게 보이기 때문이다.
// 러너에는 런타임 의존 패키지가 없어 Mustache 라이브러리 대신 태그만 훑는다 (웹은 mustache 4로 그린다).
export class AppCodeCheck {
  static readonly ENTRY = 'index.html';
  static readonly MANIFEST = 'cairn.json';
  static readonly FILES_MAX = 100;
  static readonly BYTES_MAX = 20 * 1024 * 1024;
  static readonly TEMPLATE_BYTES_MAX = 1024 * 1024;
  static readonly HOSTS_MAX = 10;
  /** 검사 이름: 일을 실패로 끝낼 것(묶음 · 문법)과 알리기만 할 것(이름) */
  static readonly BUNDLE = '앱 코드 묶음';
  static readonly SYNTAX = '템플릿 문법';
  static readonly DATA = '데이터 이름';
  /**
   * 데이터 약속 cairn: 1의 이름 (docs/스토어.md 9.3, 서버 app-screen.view.ts + 웹이 더하는 html · dateText · site.name).
   * 섹션 안에서는 항목의 칸을 이름만으로 쓰므로 어느 깊이의 이름이든 받는다. 약속은 이름을 더하기만 한다:
   * 서버 테스트(app-code.api.test)가 실제 화면 데이터의 이름이 모두 여기 있는지 본다
   */
  // biome-ignore format: 줄마다 데이터의 한 덩어리
  static readonly NAMES: readonly string[] = [
    'cairn', 'screen', 'isHome', 'isPost', 'isMenu', 'isIssue', 'title', 'base', 'files',
    'site', 'home', 'loginUrl', 'graphUrl', 'name',
    'app', 'description', 'kind', 'url', 'iconUrl', 'rssUrl',
    'apps', 'others', 'current', 'menus', 'active',
    'menu', 'isPosts', 'isIssues', 'isPages', 'isPage',
    'posts', 'more', 'excerpt', 'date', 'dateText', 'tags',
    'post', 'html', 'center', 'listed', 'back',
    'issues', 'issue', 'number', 'intro', 'pages', 'length',
  ];
  private static readonly KNOWN = new Set(AppCodeCheck.NAMES);
  private static readonly TEMPLATE = /\.html$/i;
  private static readonly HOST =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  /** AI에게 보일 문제 줄 수 */
  private static readonly SHOWN = 20;

  static isTemplate(name: string): boolean {
    return AppCodeCheck.TEMPLATE.test(name);
  }

  /** 앞 코드 위에 낸 파일을 얹은 모양의 검사. made가 비면 검사하지 않는다 (결과물 파일 검사가 떨어진다) */
  static checks(base: AppCodeBase, made: readonly AppCodeEntry[]): StageCheck[] {
    if (made.length === 0) return [];
    const all = new Map<string, AppCodeEntry>();
    for (const f of base.files) all.set(f.name, new AppCodeEntry(f.name, f.size, f.text));
    for (const f of made) all.set(f.name, f);
    const checks = [AppCodeCheck.bundle([...all.values()], made)];
    const templates = made.filter((f) => AppCodeCheck.isTemplate(f.name));
    if (templates.length === 0) return checks;
    const syntax: string[] = [];
    const unknown: string[] = [];
    for (const f of templates) {
      if (f.text === null) {
        syntax.push(`${f.name}: 읽지 못했어요 (템플릿은 합쳐 1MB까지)`);
        continue;
      }
      const scan = AppCodeCheck.scan(f.text, (partial) => all.has(`${partial}.html`));
      syntax.push(...scan.problems.map((p) => `${f.name}:${p}`));
      for (const name of scan.names)
        if (!AppCodeCheck.KNOWN.has(name)) unknown.push(`${f.name}: ${name}`);
    }
    checks.push(
      AppCodeCheck.seen(
        AppCodeCheck.SYNTAX,
        syntax,
        `${templates.length}개`,
        '웹이 Mustache로 채워요. 아래를 고쳐요',
      ),
      AppCodeCheck.seen(
        AppCodeCheck.DATA,
        unknown,
        '모두 약속에 있음',
        '데이터 약속(cairn: 1)에 없는 이름은 빈 칸으로 그려져요. 스킬의 references/app-code.md의 이름을 써요',
      ),
    );
    return checks;
  }

  /** 일을 실패로 끝낼 검사(묶음 · 문법)가 떨어졌는가 */
  static fatal(checks: readonly StageCheck[]): StageCheck | null {
    const names = [AppCodeCheck.BUNDLE, AppCodeCheck.SYNTAX];
    return checks.find((c) => !c.ok && names.includes(c.name)) ?? null;
  }

  private static bundle(all: readonly AppCodeEntry[], made: readonly AppCodeEntry[]): StageCheck {
    const problems: string[] = [];
    const bytes = all.reduce((sum, f) => sum + f.size, 0);
    const templates = all
      .filter((f) => AppCodeCheck.isTemplate(f.name))
      .reduce((sum, f) => sum + f.size, 0);
    if (all.length > AppCodeCheck.FILES_MAX)
      problems.push(`파일은 ${AppCodeCheck.FILES_MAX}개까지예요 (얹으면 ${all.length}개)`);
    if (bytes > AppCodeCheck.BYTES_MAX) problems.push('파일은 합쳐 20MB까지예요');
    if (templates > AppCodeCheck.TEMPLATE_BYTES_MAX)
      problems.push('템플릿(.html)은 합쳐 1MB까지예요');
    if (!all.some((f) => f.name === AppCodeCheck.ENTRY))
      problems.push(`${AppCodeCheck.ENTRY}가 없어요 (모든 화면의 기본 템플릿)`);
    const manifest = made.find((f) => f.name === AppCodeCheck.MANIFEST);
    if (manifest) problems.push(...AppCodeCheck.manifestProblems(manifest.text));
    const size = bytes < 1024 ? `${bytes}B` : `${Math.round(bytes / 1024)}KB`;
    return AppCodeCheck.seen(AppCodeCheck.BUNDLE, problems, `${all.length}개 · ${size}`, '');
  }

  /** cairn.json의 모양 (서버의 AppCodeBundle.hostsOf와 같은 규칙) */
  private static manifestProblems(text: string | null): string[] {
    const name = AppCodeCheck.MANIFEST;
    if (text === null) return [`${name}을 읽지 못했어요 (16KB까지)`];
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [`${name}이 JSON이 아니에요`];
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      return [`${name}은 객체여야 해요`];
    const { cairn, hosts = [] } = parsed as { cairn?: unknown; hosts?: unknown };
    if (cairn !== undefined && cairn !== 1) return ['데이터 약속(cairn)은 1이에요'];
    if (!Array.isArray(hosts) || hosts.length > AppCodeCheck.HOSTS_MAX)
      return ['바깥 주소(hosts)는 10개까지의 목록이에요'];
    return hosts
      .filter((h) => typeof h !== 'string' || !AppCodeCheck.HOST.test(h))
      .map((h) => `바깥 주소는 정확한 호스트 이름만 (와일드카드 · IP · 포트 없이): ${String(h)}`);
  }

  /**
   * 템플릿의 태그를 훑는다 (mustache 4와 같은 태그: {{이름}} · {{{이름}}} · {{&이름}} · {{#이름}} · {{^이름}} · {{/이름}}
   * · {{>조각}} · {{!설명}}). 문제는 "줄: 까닭", 이름은 점 앞의 첫 마디 (섹션 안의 항목 칸도 같은 이름이다)
   */
  static scan(text: string, hasPartial: (name: string) => boolean): TemplateScan {
    const result = new TemplateScan();
    const open: { name: string; line: number }[] = [];
    let at = 0;
    let line = 1;
    let counted = 0;
    const lineAt = (index: number) => {
      for (let i = counted; i < index; i++) if (text.charCodeAt(i) === 10) line++;
      counted = index;
      return line;
    };
    for (;;) {
      const start = text.indexOf('{{', at);
      if (start < 0) break;
      const where = lineAt(start);
      const triple = text.startsWith('{{{', start);
      const closer = triple ? '}}}' : '}}';
      const end = text.indexOf(closer, start + closer.length);
      if (end < 0) {
        result.problems.push(`${where}: 닫히지 않은 ${triple ? '{{{' : '{{'}`);
        break;
      }
      at = end + closer.length;
      const inner = text.slice(start + closer.length, end).trim();
      const sigil = triple ? '{' : /^[#^/>!&=]/.test(inner) ? (inner[0] ?? '') : '';
      const name = (triple || sigil === '' ? inner : inner.slice(1)).trim();
      if (sigil === '!') continue;
      if (sigil === '=') {
        result.problems.push(`${where}: 구분자 바꾸기({{= =}})는 쓰지 않아요`);
        continue;
      }
      if (name === '') {
        result.problems.push(`${where}: 이름이 빈 태그`);
        continue;
      }
      if (sigil === '/') {
        const top = open.pop();
        if (!top) result.problems.push(`${where}: 열지 않은 {{/${name}}}`);
        else if (top.name !== name)
          result.problems.push(
            `${where}: ${top.line}줄의 {{#${top.name}}}을 {{/${name}}}로 닫았어요`,
          );
        continue;
      }
      if (sigil === '>') {
        if (!hasPartial(name))
          result.problems.push(`${where}: 없는 조각 {{> ${name}}} (${name}.html이 없어요)`);
        continue;
      }
      if (sigil === '#' || sigil === '^') open.push({ name, line: where });
      if ((sigil === '{' || sigil === '&') && name !== 'html' && !name.endsWith('.html'))
        result.problems.push(
          `${where}: {{{${name}}}}는 글자를 그대로 넣어요. html 값(post.html)에만 쓰고 나머지는 {{${name}}}로`,
        );
      if (name !== '.') result.names.add(name.split('.')[0] ?? name);
    }
    for (const left of open)
      result.problems.push(`${left.line}: {{#${left.name}}}을 닫지 않았어요 ({{/${left.name}}})`);
    return result;
  }

  private static seen(
    name: string,
    problems: readonly string[],
    ok: string,
    why: string,
  ): StageCheck {
    if (problems.length === 0) return StageCheck.seen(name, true, ok, '');
    const shown = problems.slice(0, AppCodeCheck.SHOWN);
    const more = problems.length - shown.length;
    const lines = [why, ...shown.map((p) => `- ${p}`), more > 0 ? `- 외 ${more}개` : '']
      .filter(Boolean)
      .join('\n');
    return StageCheck.seen(name, false, `문제 ${problems.length}개`, lines);
  }
}
