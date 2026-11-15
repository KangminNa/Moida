/**
 * 사이트 도구 코드의 규칙 검사 (2026-11-16 MCP 2단계). AI가 쓴 코드를 돌리기 전에(굳히기의 시험 · 실행마다) 본다.
 * 코드는 `async ({ page, input, site }) => 답`의 본문이고, 받은 page로 그 사이트를 읽기만 해야 한다.
 * 막는 것: 모듈 · 프로세스 · 전역에 닿는 이름, 다른 탭 · 컨텍스트 · 브라우저 · 요청 API(허용 출처 밖으로 가는 길),
 * 코드를 만들어 돌리는 길(eval · Function · constructor), 비밀값처럼 생긴 글자.
 * OS 격리가 아니다: 자식 프로세스(--permission, 빈 환경) · vm의 빈 맥락 · 관리자 승인과 겹쳐 버틴다 (docs/MCP.md 6장)
 */
export class IntegrationRules {
  static readonly CODE_MAX = 32_000;
  /** 낱말로 막는 이름 (앞뒤가 글자 · 숫자 · _ · $가 아닐 때) */
  private static readonly WORDS = [
    'require',
    'import',
    'process',
    'globalThis',
    'global',
    'module',
    'exports',
    'constructor',
    '__proto__',
    'prototype',
    'eval',
    'Function',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'Worker',
    'child_process',
    'Buffer',
    'context',
    'browser',
    'newPage',
    'request',
    'route',
    'unroute',
    'routeFromHAR',
    'popup',
    'exposeFunction',
    'exposeBinding',
    'addInitScript',
    'setExtraHTTPHeaders',
    'storageState',
    'cookies',
    'addCookies',
    'clearCookies',
    'download',
    'setInputFiles',
  ];
  /** 비밀값처럼 생긴 글자 (키 모양): 코드에 박힌 토큰은 받지 않는다 */
  private static readonly SECRETS = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /gh[pousr]_[A-Za-z0-9]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /xox[abprs]-[A-Za-z0-9-]{10,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];

  /** 틀린 점들. 비면 통과 */
  static problems(code: string): string[] {
    if (code.trim() === '') return ['코드가 비었어요'];
    if (code.length > IntegrationRules.CODE_MAX)
      return [`코드는 ${IntegrationRules.CODE_MAX}자까지예요`];
    const found = IntegrationRules.WORDS.filter((word) =>
      new RegExp(`(^|[^A-Za-z0-9_$])${word.replace(/\$/g, '\\$')}($|[^A-Za-z0-9_$])`).test(code),
    );
    const problems = found.length > 0 ? [`쓰지 않는 이름: ${found.join(', ')}`] : [];
    if (/\\u[0-9a-fA-F{]|\\x[0-9a-fA-F]/.test(code))
      problems.push('이스케이프로 쓴 글자(\\u · \\x)는 쓰지 않아요');
    if (/[A-Za-z0-9_$)\]]\s*\[\s*['"`]/.test(code))
      problems.push("글자로 칸에 닿는 접근(obj['…'])은 쓰지 않아요");
    if (IntegrationRules.SECRETS.some((pattern) => pattern.test(code)))
      problems.push('비밀값처럼 생긴 글자가 있어요');
    return problems;
  }
}
