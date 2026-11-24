import type { DevToolsSession } from './browser-tabs';

// 누르기 전 내용 확인 (2026-11-24). AI가 마지막 버튼 앞에서 멈출 때 확인할 값(받는 사람 · 금액 · 제목 · 상품 번호처럼
// 화면에 보이는 글자)을 browser-stop.json의 check에 적으면, 러너(AI 없음)가 붙잡을 때와 승인 뒤 누르기 직전에
// 그 글자가 화면에 있는지 본다. 없으면 붙잡지 않고(AI가 화면을 잘못 읽었다) 누르지 않는다(승인한 뒤 화면이 바뀌었다).
// 화면의 글자는 보이는 글(innerText)과 입력 칸에 들어 있는 값이다. 숨긴 요소의 글자는 innerText에 없어 맞춰지지 않는다.
// 공백은 하나로, 대소문자는 가리지 않는다 (금액의 쉼표 · 단위는 화면 그대로 적는다). 숫자로 시작하거나 끝나는 글자는
// 숫자의 가운데와 맞추지 않는다: "5,000원"은 "15,000원"에, "10"은 "100"에 맞지 않는다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 확인 한 곳. BrowserStop · BrowserPages가 쓴다
export class PageChecks {
  /** check에 적을 수 있는 수 · 하나의 길이 (서버 browser_click_hold의 checks와 같다) */
  static readonly MAX = 5;
  static readonly LENGTH = 100;

  /** 페이지에서 돌려 화면의 글자를 모으는 식 (Runtime.evaluate) */
  static readonly EXPRESSION = `(() => {
    const parts = [document.body ? document.body.innerText : ''];
    for (const el of document.querySelectorAll('input, textarea, select')) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden' || type === 'password') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.tagName === 'SELECT') parts.push(Array.from(el.selectedOptions).map((o) => o.text).join(' '));
      else parts.push(String(el.value || ''));
    }
    return parts.join('\\n');
  })()`;

  /** browser-stop.json의 check: 글자 목록 (1~100자, 5개까지). 모양이 틀리면 까닭, 없으면 빈 목록 */
  static of(raw: unknown): readonly string[] | string {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > PageChecks.MAX)
      return `check는 ${PageChecks.MAX}개까지의 글자 목록이에요`;
    const checks = raw.map((c) => (typeof c === 'string' ? PageChecks.normal(c) : ''));
    if (checks.some((c) => c.length === 0 || c.length > PageChecks.LENGTH))
      return `check의 글자는 하나에 1~${PageChecks.LENGTH}자예요`;
    return [...new Set(checks)];
  }

  /** 화면에 없는 글자들 (모두 있으면 빈 목록) */
  static missing(screen: string, checks: readonly string[]): string[] {
    const text = PageChecks.normal(screen);
    return checks.filter((c) => !PageChecks.pattern(c).test(text));
  }

  /** 글자 하나의 맞춤: 그대로(대소문자 무시)이되 숫자 앞뒤로 숫자가 이어지지 않게 */
  private static pattern(check: string): RegExp {
    const c = PageChecks.normal(check);
    const body = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const head = /^\p{N}/u.test(c) ? '(?<![\\p{N}][,.]?)' : '';
    const tail = /\p{N}$/u.test(c) ? '(?![,.]?\\p{N})' : '';
    return new RegExp(`${head}${body}${tail}`, 'iu');
  }

  /** 탭의 화면에서 확인할 글자를 찾는다: 없는 것의 까닭 한 줄. 모두 있거나 확인할 것이 없으면 null */
  static async onPage(s: DevToolsSession, checks: readonly string[]): Promise<string | null> {
    if (checks.length === 0) return null;
    const read = await s.send('Runtime.evaluate', {
      expression: PageChecks.EXPRESSION,
      returnByValue: true,
    });
    const screen = String((read.result as { value?: unknown } | undefined)?.value ?? '');
    const missing = PageChecks.missing(screen, checks);
    return missing.length > 0 ? PageChecks.problem(missing) : null;
  }

  /** 없는 글자를 관리자에게 보일 한 줄로 */
  static problem(missing: readonly string[]): string {
    return `화면에 없는 내용: ${missing.map((m) => `"${m}"`).join(', ')}`;
  }

  private static normal(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }
}
