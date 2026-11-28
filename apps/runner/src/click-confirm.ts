import type { DevToolsSession } from './browser-tabs';

// 승인 후 클릭 뒤 확인 단계 (L3, 기획서 결정 2026-11-17): 러너(AI 없음)가 결재된 버튼을 누른 뒤 그 화면을 한 번 더 읽어
//   auth: 결제 · 본인 인증 화면이 떴다 → 관리자가 대화 카드의 서버 브라우저 화면에서 마친다 (값은 AI를 거치지 않는다, 원칙 8)
//   done: 결과 화면 → 예약 · 주문 · 접수 번호가 보이면 그 번호를 남긴다
// 화면의 글은 서버로 보내지 않는다: 남기는 것은 상태 · 번호(40자) · 페이지 제목(100자)뿐이다 (개인정보 규칙 2026-11-17)
export class ClickConfirm {
  static readonly AUTH = 'auth';
  static readonly DONE = 'done';
  /** 인증 화면의 말 (결제 인증 · 본인 인증 · 일회용 번호) */
  private static readonly AUTH_WORDS =
    /본인\s*인증|인증\s*번호|휴대폰\s*인증|간편\s*인증|보안\s*카드|일회용\s*비밀번호|OTP|3D\s*Secure|ISP\s*인증|안심\s*클릭|2단계\s*인증|verification code|verify (it'?s|your)|two-factor/i;
  /** 결과의 번호: "예약번호: AB-1234" 처럼 이름 뒤의 영숫자 */
  private static readonly REFERENCE =
    /(?:예약|주문|접수|승인|신청|확인|티켓|booking|order|confirmation|reservation)\s*(?:번호|no\.?|number|#)\s*[:：#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,39})/i;
  private static readonly TITLE_MAX = 100;
  private static readonly READ_MAX = 20_000;
  private static readonly EXPRESSION = `(() => ({
    title: document.title || '',
    text: (document.body ? document.body.innerText : '').slice(0, ${ClickConfirm.READ_MAX}),
  }))()`;

  constructor(
    readonly state: 'auth' | 'done',
    readonly reference: string | null,
    readonly title: string | null,
  ) {}

  /** 화면의 제목 · 글에서 상태와 번호를 고른다. 인증 화면이 먼저다 (번호보다 사람의 일이 급하다) */
  static of(title: string, text: string): ClickConfirm {
    const head = title.replace(/\s+/g, ' ').trim().slice(0, ClickConfirm.TITLE_MAX) || null;
    if (ClickConfirm.AUTH_WORDS.test(`${title}\n${text}`))
      return new ClickConfirm(ClickConfirm.AUTH, null, head);
    const found = ClickConfirm.REFERENCE.exec(text);
    return new ClickConfirm(ClickConfirm.DONE, found?.[1] ?? null, head);
  }

  /** 누른 뒤의 탭에서 읽는다. 읽지 못하면 null (확인 없이 누른 결과만 남는다) */
  static async read(s: DevToolsSession): Promise<ClickConfirm | null> {
    const read = await s.send('Runtime.evaluate', {
      expression: ClickConfirm.EXPRESSION,
      returnByValue: true,
    });
    const value = (read.result as { value?: { title?: unknown; text?: unknown } } | undefined)
      ?.value;
    if (!value) return null;
    return ClickConfirm.of(String(value.title ?? ''), String(value.text ?? ''));
  }

  /** 서버에 보내는 모양 (browser_click_save · browser_press_save의 confirm) */
  toJSON() {
    return {
      state: this.state,
      ...(this.reference ? { reference: this.reference } : {}),
      ...(this.title ? { title: this.title } : {}),
    };
  }
}
