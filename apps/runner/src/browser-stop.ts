import { lstat, readFile } from 'node:fs/promises';
import { ButtonRef } from './browser-page';
import { LoginFormRef } from './login-form-ref';

/** 멈춘 자리를 읽지 못함 (모양이 틀림). 누를 것을 붙잡지 않는다 */
export class BrowserStopProblem extends Error {}

// AI가 멈춘 자리 (cairn-browse 스킬). AI는 결재를 올리지 않고 작업 폴더에 browser-stop.json을 쓰고 끝낸다:
//   { "stop": "final_click", "page_url": "...", "button": { "role": "button", "name": "게시", "nth": 0 }, "note": "..." }
//   { "stop": "login", "page_url": "...", "reason": "캡차" }
//   { "stop": "click_plan", "page_url": "...", "plan": { "summary": "네이버 지도 '대구 여행' 목록에 12곳 저장", "count": 12 } }
//   { "stop": "login", "page_url": "...", "form": { "fields": [{ "kind": "id", "role": "textbox", "name": "아이디" }, …],
//     "submit": { "role": "button", "name": "로그인" } } }
// login은 사람이 해야 하는 화면이다 (2026-11-17 넓힘): 로그인뿐 아니라 가입 · 본인 인증 · 캡차 · 새 기기 확인. reason은 그 까닭 (없으면 로그인).
// form은 그 화면의 로그인 칸 (로그인 카드, 2026-11-19): 칸마다 종류 · 역할 · 이름만 적고 값은 적지 않는다. 관리자가 카드의 칸에 넣은 값은
// AI 없이 러너가 그 칸에 넣는다 (LoginRunner). 모양이 틀리면 form만 버린다 (화면에서 직접 로그인으로).
// click_plan은 같은 사이트에서 마지막 버튼을 여러 번 누르는 일의 계획이다 (F2, 2026-11-21): 승인되면 같은 일이 이어서 돌고
// AI가 버튼마다 browser_press로 요청하면 러너가 누른다 (PressLoop). summary는 무엇을, count는 몇 번 (1~50).
// 러너(AI 없음)가 읽어 버튼을 다시 찾아 붙잡거나(결재된 클릭) 로그인 필요 · 계획 결재를 올린다. 믿지 않는 입력이라 모양을 본다.
export class BrowserStop {
  static readonly FILE = 'browser-stop.json';
  private static readonly SIZE_MAX = 10_000;
  private static readonly ROLE = /^[a-z]{1,40}$/;
  private static readonly REASON_MAX = 30;
  private static readonly PLAN_MAX = 50;

  private constructor(
    /** final_click · login · click_plan */
    readonly kind: 'final_click' | 'login' | 'click_plan',
    readonly pageUrl: string,
    /** 마지막 버튼 (final_click만) */
    readonly button: ButtonRef | null,
    readonly note: string | null,
    /** 사람이 해야 하는 까닭 (login만, 승인 메모 · 카드 제목에 보인다). 없으면 로그인 */
    readonly reason: string | null = null,
    /** 로그인 칸 (login만). 없거나 모양이 틀리면 null */
    readonly form: LoginFormRef | null = null,
    /** 누르기 계획 (click_plan만) */
    readonly plan: { summary: string; count: number } | null = null,
  ) {}

  /** 파일을 읽는다. 없으면 null (AI가 멈추지 않고 끝냈다). 링크 · 큰 파일 · 틀린 모양은 BrowserStopProblem */
  static async read(path: string): Promise<BrowserStop | null> {
    const info = await lstat(path).catch(() => null);
    if (info === null) return null;
    if (!info.isFile() || info.size > BrowserStop.SIZE_MAX)
      throw new BrowserStopProblem(`${BrowserStop.FILE}가 보통 파일이 아니거나 너무 커요`);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new BrowserStopProblem(`${BrowserStop.FILE}가 JSON이 아니에요`);
    }
    return BrowserStop.of(raw);
  }

  static of(raw: unknown): BrowserStop {
    const r = (raw ?? {}) as Record<string, unknown>;
    const url = typeof r.page_url === 'string' ? r.page_url.trim() : '';
    if (!/^https?:\/\//i.test(url) || url.length > 2000 || !URL.canParse(url))
      throw new BrowserStopProblem('page_url은 http · https 주소여야 해요');
    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 500) : null;
    if (r.stop === 'login')
      return new BrowserStop(
        'login',
        url,
        null,
        note,
        BrowserStop.reasonOf(r),
        LoginFormRef.of(r.form),
      );
    if (r.stop === 'click_plan')
      return new BrowserStop('click_plan', url, null, note, null, null, BrowserStop.planOf(r));
    if (r.stop !== 'final_click')
      throw new BrowserStopProblem('stop은 final_click · login · click_plan 중 하나예요');
    const b = (r.button ?? {}) as Record<string, unknown>;
    const role = typeof b.role === 'string' ? b.role.trim().toLowerCase() : '';
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const nth = b.nth === undefined ? 0 : b.nth;
    if (!BrowserStop.ROLE.test(role))
      throw new BrowserStopProblem('button.role은 button · link 같은 역할이에요');
    if (name.length === 0 || name.length > 200)
      throw new BrowserStopProblem('button.name은 1~200자예요');
    if (typeof nth !== 'number' || !Number.isInteger(nth) || nth < 0 || nth > 50)
      throw new BrowserStopProblem('button.nth는 0~50이에요');
    return new BrowserStop('final_click', url, new ButtonRef(role, name, nth), note);
  }

  /** 누르기 계획: 한 줄로 다듬은 요약(1~300자)과 횟수(1~50) */
  private static planOf(r: Record<string, unknown>): { summary: string; count: number } {
    const p = (r.plan ?? {}) as Record<string, unknown>;
    const summary =
      typeof p.summary === 'string' ? p.summary.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (!summary) throw new BrowserStopProblem('plan.summary는 무엇을 누르는지 한 줄이에요');
    const count = p.count;
    if (
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > BrowserStop.PLAN_MAX
    )
      throw new BrowserStopProblem(`plan.count는 1~${BrowserStop.PLAN_MAX}이에요`);
    return { summary, count };
  }

  /** 까닭 한마디: 한 줄 · 괄호 없이 · 짧게 (승인 메모의 "확인 필요(까닭)"에 들어간다). 비었으면 null */
  private static reasonOf(r: Record<string, unknown>): string | null {
    if (typeof r.reason !== 'string') return null;
    const reason = r.reason
      .replace(/[()\p{Cc}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, BrowserStop.REASON_MAX)
      .trim();
    return reason || null;
  }
}
