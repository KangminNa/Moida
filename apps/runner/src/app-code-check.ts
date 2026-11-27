import type { AppCodeBase } from './app-code-base';
import { AppManifestCheck } from './app-manifest-check';
import { DesignCheck } from './design-check';
import { DesignDocCheck } from './design-doc-check';
import { MapCreditCheck } from './map-credit-check';
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
// 정적 앱 (cairn.json의 "render": "static", 스토어 9.13)은 템플릿이 아니라 파일 그대로 나가므로 묶음 규칙만 본다
// (500개 · 경로 여섯 마디 · HTML 하나 1MB, 어느 종류의 앱이든). 선언서(cairn.json)의 모양은 AppManifestCheck가 본다. 폴더가 든 결과는 app.zip 하나로 내고, 그 안이 묶음 전체다 (packed).
// 떨어지면 JobRun이 AI에게 한 번 더 맡긴다 (검증 고리 V). 그래도 묶음 · 문법이 틀리면 MakeStage가 일을 실패로 끝낸다:
// 서버는 Mustache를 읽지 않아 틀린 템플릿도 버전이 되고, 비공개 앱은 바로 방문자(관리자)에게 보이기 때문이다.
// 러너에는 런타임 의존 패키지가 없어 Mustache 라이브러리 대신 태그만 훑는다 (웹은 mustache 4로 그린다).
export class AppCodeCheck {
  static readonly ENTRY = 'index.html';
  static readonly MANIFEST = AppManifestCheck.FILE;
  /** 폴더가 든 묶음 전체를 내는 zip의 이름 (서버의 AppCodeService.BUILD_ZIP) */
  static readonly PACKED = 'app.zip';
  static readonly FILES_MAX = 100;
  /** 정적 앱의 한도 (서버의 PageFiles.NESTED_MAX · DEPTH_MAX · PATH_MAX) */
  static readonly STATIC_FILES_MAX = 500;
  static readonly DEPTH_MAX = 6;
  static readonly PATH_MAX = 300;
  static readonly BYTES_MAX = 20 * 1024 * 1024;
  static readonly TEMPLATE_BYTES_MAX = 1024 * 1024;
  /** 검사 이름: 일을 실패로 끝낼 것(묶음 · 문법)과 알리기만 할 것(이름) */
  static readonly BUNDLE = '앱 코드 묶음';
  static readonly SYNTAX = '템플릿 문법';
  static readonly DATA = '데이터 이름';
  /**
   * 데이터 약속 cairn: 1의 이름 (docs/스토어.md 9.3, 서버 app-screen.view.ts + 웹이 더하는 html · dateText · site.name,
   * 커뮤니티의 topics · topic · community는 웹이 회원 API로 채운다: 스토어 3-2).
   * 섹션 안에서는 항목의 칸을 이름만으로 쓰므로 어느 깊이의 이름이든 받는다. 약속은 이름을 더하기만 한다:
   * 서버 테스트(app-code.api.test)가 실제 화면 데이터의 이름이 모두 여기 있는지 본다
   */
  // biome-ignore format: 줄마다 데이터의 한 덩어리
  static readonly NAMES: readonly string[] = [
    'cairn', 'screen', 'isHome', 'isPost', 'isMenu', 'isIssue', 'title', 'base', 'files',
    'site', 'home', 'store', 'loginUrl', 'graphUrl', 'name',
    'app', 'description', 'kind', 'url', 'iconUrl', 'rssUrl',
    'apps', 'others', 'current', 'menus', 'active',
    'menu', 'isPosts', 'isIssues', 'isPages', 'isPage', 'isView', 'view',
    'posts', 'more', 'excerpt', 'date', 'dateText', 'tags',
    'post', 'html', 'center', 'listed', 'back',
    'issues', 'issue', 'number', 'intro', 'pages', 'length',
    'isTopic', 'topic', 'topics', 'author', 'nickname', 'comments', 'body', 'edited', 'mine',
    'editUrl', 'commentUrl', 'reportUrl', 'community', 'open', 'member', 'joinUrl', 'meUrl', 'writeUrl',
  ];
  private static readonly KNOWN = new Set(AppCodeCheck.NAMES);
  private static readonly TEMPLATE = /\.html$/i;
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
    const fixed = AppManifestCheck.isStatic(all.get(AppCodeCheck.MANIFEST)?.text ?? null);
    const checks = [AppCodeCheck.bundle([...all.values()], made, fixed, base.kind)];
    // 디자인 기준 (references/design.md): 낸 HTML · CSS가 있을 때만
    const design = DesignCheck.check(made, [...all.values()]);
    if (design) checks.push(design);
    // 디자인 문서 (references/design-research.md): 화면을 냈으면 묶음에 design.md가 있어야 한다
    const doc = DesignDocCheck.check(made, [...all.values()]);
    if (doc) checks.push(doc);
    // 지도 출처 표시 (docs/지도.md MP-3): 낸 CSS가 지도 위의 출처 · 로고를 숨기면
    const credit = MapCreditCheck.check(made);
    if (credit) checks.push(credit);
    // 정적 앱의 HTML은 템플릿이 아니다: 문법 · 데이터 이름을 보지 않는다
    const templates = fixed ? [] : made.filter((f) => AppCodeCheck.isTemplate(f.name));
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

  /**
   * app.zip을 낸 일: zip 안이 묶음 전체다 (스토어 9.13). 앞 코드에서 내용을 받지 못한 파일(그림 · 큰 파일)은 zip에 없어도
   * 서버가 남긴다. entries: zip 안의 파일 (cairn.json · design.md만 글까지). 읽지 못한 zip이면 null
   */
  static packed(base: AppCodeBase, entries: readonly AppCodeEntry[] | null): StageCheck[] {
    const zip = AppCodeCheck.PACKED;
    if (entries === null)
      return [
        AppCodeCheck.seen(
          AppCodeCheck.BUNDLE,
          [`${zip}을 읽지 못했어요 (20MB까지의 보통 zip으로, 암호 없이)`],
          '',
          '',
        ),
      ];
    const inside = new Set(entries.map((f) => f.name));
    const kept = base.files
      .filter((f) => f.text === null && !inside.has(f.name))
      .map((f) => new AppCodeEntry(f.name, f.size, null));
    const manifest = entries.find((f) => f.name === AppCodeCheck.MANIFEST);
    const fixed = AppManifestCheck.isStatic(manifest?.text ?? null);
    const extra = fixed
      ? []
      : [
          `${zip}은 정적 앱의 묶음 전체예요. zip 안의 cairn.json에 "render": "static"을 넣어요 (템플릿 앱은 바뀐 파일만 그대로 내요)`,
        ];
    const checks = [AppCodeCheck.bundle([...kept, ...entries], entries, fixed, base.kind, extra)];
    const doc = DesignDocCheck.check(entries, [
      ...base.files
        .map((f) => new AppCodeEntry(f.name, f.size, f.text))
        .filter((f) => !inside.has(f.name)),
      ...entries,
    ]);
    if (doc) checks.push(doc);
    return checks;
  }

  /** 일을 실패로 끝낼 검사(묶음 · 문법)가 떨어졌는가 */
  static fatal(checks: readonly StageCheck[]): StageCheck | null {
    const names = [AppCodeCheck.BUNDLE, AppCodeCheck.SYNTAX];
    return checks.find((c) => !c.ok && names.includes(c.name)) ?? null;
  }

  /** fixed: 정적 앱의 묶음인가. kind: 앱의 종류. extra: 먼저 적을 문제 */
  private static bundle(
    all: readonly AppCodeEntry[],
    made: readonly AppCodeEntry[],
    fixed: boolean,
    kind: string,
    extra: readonly string[] = [],
  ): StageCheck {
    const problems: string[] = [...extra];
    const bytes = all.reduce((sum, f) => sum + f.size, 0);
    const pages = all.filter((f) => AppCodeCheck.isTemplate(f.name));
    const max = fixed ? AppCodeCheck.STATIC_FILES_MAX : AppCodeCheck.FILES_MAX;
    if (all.length > max) problems.push(`파일은 ${max}개까지예요 (모두 ${all.length}개)`);
    if (bytes > AppCodeCheck.BYTES_MAX) problems.push('파일은 합쳐 20MB까지예요');
    if (fixed) problems.push(...AppCodeCheck.staticProblems(all, pages));
    else {
      if (pages.reduce((sum, f) => sum + f.size, 0) > AppCodeCheck.TEMPLATE_BYTES_MAX)
        problems.push('템플릿(.html)은 합쳐 1MB까지예요');
      const nested = all.find((f) => f.name.includes('/'));
      if (nested)
        problems.push(`폴더는 정적 앱만 써요: ${nested.name} (cairn.json에 "render": "static")`);
    }
    if (!all.some((f) => f.name === AppCodeCheck.ENTRY))
      problems.push(
        `${AppCodeCheck.ENTRY}가 없어요 (${fixed ? '앱의 첫 화면' : '모든 화면의 기본 템플릿'})`,
      );
    const manifest = made.find((f) => f.name === AppCodeCheck.MANIFEST);
    if (manifest)
      problems.push(
        ...AppManifestCheck.problems(manifest.text, kind, new Set(all.map((f) => f.name))),
      );
    const size = bytes < 1024 ? `${bytes}B` : `${Math.round(bytes / 1024)}KB`;
    return AppCodeCheck.seen(AppCodeCheck.BUNDLE, problems, `${all.length}개 · ${size}`, '');
  }

  /** 정적 앱의 묶음 규칙 (서버의 AppCodeBundle · PageFiles와 같다) */
  private static staticProblems(
    all: readonly AppCodeEntry[],
    pages: readonly AppCodeEntry[],
  ): string[] {
    const problems: string[] = [];
    const big = pages.find((f) => f.size > AppCodeCheck.TEMPLATE_BYTES_MAX);
    if (big) problems.push(`HTML 파일 하나는 1MB까지예요: ${big.name}`);
    const bad = all.find((f) => {
      const parts = f.name.split('/');
      return (
        f.name.length > AppCodeCheck.PATH_MAX ||
        parts.length > AppCodeCheck.DEPTH_MAX ||
        parts.some((part) => part === '' || part.startsWith('.') || part.length > 120)
      );
    });
    if (bad)
      problems.push(
        `쓸 수 없는 이름이에요: ${bad.name} (경로는 파일까지 ${AppCodeCheck.DEPTH_MAX}마디, ${AppCodeCheck.PATH_MAX}자까지, 숨김 파일 없이)`,
      );
    return problems;
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
