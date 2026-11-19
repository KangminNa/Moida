// 구조 검사 (docs/객체설계.md 6장 "폴더와 표"의 "콘솔 메뉴 하나의 구조"). pnpm check가 돌린다.
//
//   1. 모듈 안의 파일 이름은 .api · .input · .view (.controller · .request · .response는 막는다)
//   2. REST 진입(.api.ts) 옆에는 같은 이름의 .api.test.ts. 다른 파일에서 시험하면
//      TESTED_ELSEWHERE에 그 파일을 적는다 (적은 파일이 없으면 실패)
//   3. 콘솔 메뉴(app/admin/menu.tsx의 href)와 app/admin/<주소>/page.tsx가 하나씩 맞는다
//   4. 웹은 서버 응답 모양을 손으로 적지 않는다: app/_lib/types.ts에는 HAND_WRITTEN_TYPES(오류 모양)만.
//      응답 타입은 서버 view에서 import type으로 만든다 (ReturnType<XxxView['toJSON']>, app/_<모듈>/types.ts)
//   5. 웹의 최상위 경로(app/의 폴더 · (묶음) 안의 폴더, next.config의 rewrites)는 앱 주소로 못 쓰는 이름(App.RESERVED)이다:
//      빠지면 그 이름의 앱 주소(/<앱>)가 웹의 화면에 가려진다 (docs/스토어.md 8.7)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = join(root, 'apps/server/src/modules');
const adminDir = join(root, 'apps/web/app/admin');
const webAppDir = join(root, 'apps/web/app');

/** 옆이 아닌 곳에서 시험하는 REST 진입 → 그 테스트 파일 (modules/ 아래). 흐름 하나를 여러 진입이 함께 이룰 때 */
const TESTED_ELSEWHERE = {
  // OAuth 흐름(등록 → 승인 → 토큰)과 MCP 입구는 기기 연결 테스트가 처음부터 끝까지 본다
  'account/device/oauth.api.ts': 'account/device/device.api.test.ts',
  'mcp/mcp.api.ts': 'account/device/device.api.test.ts',
  // 로그인 · 블로그 정보는 설치 마법사 흐름에서
  'account/owner/login.api.ts': 'account/space/install.api.test.ts',
  'account/space/space.api.ts': 'account/space/install.api.test.ts',
  // 작업 · 결재 · 에이전트와 그 변경 신호는 작업 흐름 하나로
  'platform/stream/stream.api.ts': 'task/task.api.test.ts',
  'task/agent/agent.api.ts': 'task/task.api.test.ts',
  'task/approval/approval.api.ts': 'task/task.api.test.ts',
  'task/task/task.api.ts': 'task/task.api.test.ts',
  // 알림은 알리는 모듈의 흐름에서 (platform은 무엇을 알리는지 모른다): 지울 만한 wiki 알림
  'platform/notice/notification.api.ts': 'vault/wiki-score/wiki-score.api.test.ts',
  // 페이지는 만들기 작업(task) → 이벤트 → blog를 잇는 흐름이라 모듈을 가로지르는 시험 폴더에서
  'blog/page/page.api.ts': '../testing/page.api.test.ts',
  // 앱 코드 (스토어 1-6): AI 작업(task) → 이벤트 → 버전 흐름을 함께 시험해 모듈 밖에 둔다
  'blog/app-code/app-code.api.ts': '../testing/app-code.api.test.ts',
};

/** app/_lib/types.ts에 손으로 적어도 되는 타입: 오류 모양(DomainError.toJSON)은 view가 아니라 모든 실패 응답의 모양이다 */
const HAND_WRITTEN_TYPES = ['ApiError'];

const OLD_SUFFIX = /\.(controller|request|response)\.ts$/;
const ENTRY = /\.api\.ts$/;
const problems = [];
const at = (file) => relative(root, file);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function checkNames(files) {
  for (const file of files)
    if (OLD_SUFFIX.test(file))
      problems.push(
        `${at(file)} 옛 이름. .api(Controller + Response) · .input · .view로 (객체설계 6장, pnpm new:bundle)`,
      );
}

function checkTests(files) {
  const seen = new Set();
  for (const file of files) {
    if (!ENTRY.test(file)) continue;
    const key = relative(modulesDir, file);
    const beside = file.replace(ENTRY, '.api.test.ts');
    const elsewhere = TESTED_ELSEWHERE[key];
    if (elsewhere) {
      seen.add(key);
      if (!existsSync(join(modulesDir, elsewhere)))
        problems.push(`${at(file)} TESTED_ELSEWHERE의 테스트 파일이 없어요: ${elsewhere}`);
    } else if (!existsSync(beside))
      problems.push(
        `${at(file)} 옆에 ${relative(dirname(file), beside)}가 없어요 (보는 사람별 결과: 방문자 · write 기기 · 주인)`,
      );
  }
  for (const key of Object.keys(TESTED_ELSEWHERE))
    if (!seen.has(key))
      problems.push(
        `scripts/check-structure.mjs TESTED_ELSEWHERE의 ${key}가 없어요. 목록에서 지워 주세요`,
      );
}

function checkMenu() {
  const menu = readFileSync(join(adminDir, 'menu.tsx'), 'utf8');
  const hrefs = new Set([...menu.matchAll(/href: (?:'([^']+)'|(\w+_HREF))/g)].map(hrefOf(menu)));
  const pages = new Set(['/admin']);
  for (const name of readdirSync(adminDir))
    if (existsSync(join(adminDir, name, 'page.tsx'))) pages.add(`/admin/${name}`);
  for (const href of hrefs)
    if (!pages.has(href))
      problems.push(`app/admin/menu.tsx ${href}의 화면이 없어요 (app${href}/page.tsx)`);
  for (const page of pages)
    if (!hrefs.has(page))
      problems.push(`app${page}/page.tsx 메뉴에 없는 화면이에요 (app/admin/menu.tsx에 한 줄)`);
}

/** href: '/admin/x' 또는 href: HOME_HREF 같은 상수 */
function hrefOf(menu) {
  return ([, literal, constant]) => {
    if (literal) return literal;
    const value = new RegExp(`const ${constant} = '([^']+)'`).exec(menu)?.[1];
    if (!value) problems.push(`app/admin/menu.tsx ${constant}의 값을 찾지 못했어요`);
    return value ?? constant;
  };
}

function checkWebTypes() {
  const file = join(root, 'apps/web/app/_lib/types.ts');
  const names = [...readFileSync(file, 'utf8').matchAll(/^export (?:type|interface) (\w+)/gm)].map(
    (m) => m[1],
  );
  for (const name of names)
    if (!HAND_WRITTEN_TYPES.includes(name))
      problems.push(
        `${at(file)} ${name}: 손으로 적은 API 타입. 서버 view에서 import type으로 (ReturnType<XxxView['toJSON']>, app/_<모듈>/types.ts)`,
      );
}

/** 앱 주소의 모양 (App.SLUG와 같다): 점 · 밑줄이 든 이름(_next · sw.js · rss.xml)은 앱 주소가 될 수 없어 보지 않는다 */
const APP_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** 웹의 최상위 경로 이름: app/의 폴더와 (묶음) 안의 폴더 ([동적]과 _비공개 폴더는 빼고), 파일 경로 · rewrites의 첫 칸 */
function topRoutes() {
  const names = new Set();
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (!statSync(path).isDirectory()) continue;
      if (/^\(.+\)$/.test(name)) visit(path);
      else if (!name.startsWith('_') && !name.startsWith('[')) names.add(name);
    }
  };
  visit(webAppDir);
  const config = readFileSync(join(root, 'apps/web/next.config.ts'), 'utf8');
  for (const [, first] of config.matchAll(/source:\s*'\/([^/:'(]+)/g)) names.add(first);
  return [...names].filter((n) => APP_SLUG.test(n));
}

function checkReserved() {
  const file = join(modulesDir, 'blog/app/app.ts');
  const block = /static readonly RESERVED[^=]*=\s*\[([^\]]*)\]/.exec(
    readFileSync(file, 'utf8'),
  )?.[1];
  if (!block) {
    problems.push(`${at(file)} App.RESERVED를 찾지 못했어요`);
    return;
  }
  const reserved = new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  for (const name of topRoutes())
    if (!reserved.has(name))
      problems.push(
        `웹의 최상위 경로 /${name}이(가) App.RESERVED에 없어요 (${at(file)}): 그 이름의 앱 주소가 화면에 가려진다`,
      );
}

/**
 * next.config의 WEB_ROUTES(화면 머리글을 붙이는 웹의 최상위 경로, 스토어 1-6)가 웹의 최상위 경로를 모두 담는가.
 * 빠지면 그 화면에 frame-ancestors 'none' · X-Frame-Options가 붙지 않는다 (앱 화면으로 여겨진다).
 * /pages · /share는 서버가 격리 머리글을 붙여 내는 경로라 next.config에 따로 적는다
 */
/** 서버가 격리 머리글을 붙여 내는 웹의 최상위 경로 (AI가 만든 페이지, 결과물 공유 링크) */
const SERVER_ISOLATED = new Set(['pages', 'share']);

function checkWebRoutes() {
  const file = join(root, 'apps/web/next.config.ts');
  const block = /const WEB_ROUTES = \[([^\]]*)\]/.exec(readFileSync(file, 'utf8'))?.[1];
  if (!block) {
    problems.push(`${at(file)} WEB_ROUTES를 찾지 못했어요`);
    return;
  }
  const listed = new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  for (const name of topRoutes())
    if (!SERVER_ISOLATED.has(name) && !listed.has(name))
      problems.push(
        `웹의 최상위 경로 /${name}이(가) ${at(file)}의 WEB_ROUTES에 없어요: 화면 머리글이 붙지 않는다`,
      );
}

const files = walk(modulesDir).filter((f) => f.endsWith('.ts'));
checkNames(files);
checkTests(files);
checkMenu();
checkWebTypes();
checkReserved();
checkWebRoutes();

if (problems.length > 0) {
  console.error(`구조 검사 위반 ${problems.length}건\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('구조 검사 통과');
