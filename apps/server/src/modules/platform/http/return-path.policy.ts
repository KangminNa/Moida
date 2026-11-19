// 로그인 뒤 돌아갈 곳 (?return=, 웹 보안 S1): 이 사이트 안의 경로만. 관리자 로그인(account)과 회원 로그인(community)이 함께 쓴다. 웹의 safeReturnPath(app/_lib/return-path.ts)와 같은 규칙.
// 글자로 "/로 시작 · //가 아님"만 보면 `/\evil.com` · 탭이 낀 `/<탭>/evil.com`이 지나간다: 브라우저는 `\`를 `/`로 읽고
// 탭 · 줄바꿈을 지워 `//evil.com`(다른 사이트)으로 간다. 그래서 브라우저와 같은 규칙(URL 해석)으로 읽어 출처가 그대로인지 보고,
// 해석한 모양을 돌려준다 (검사한 곳과 실제로 가는 곳이 같게)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳 (Input이 부른다)
export class ReturnPath {
  /** 출처를 비교할 가짜 출처 (어디에도 닿지 않는 이름) */
  private static readonly BASE = 'http://return.invalid';

  /** 이 사이트 안의 경로면 해석한 경로(경로 · 쿼리 · 조각), 아니면 null */
  static safe(raw: string): string | null {
    if (!raw.startsWith('/')) return null;
    let url: URL;
    try {
      url = new URL(raw, ReturnPath.BASE);
    } catch {
      return null;
    }
    if (url.origin !== ReturnPath.BASE) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  }
}
