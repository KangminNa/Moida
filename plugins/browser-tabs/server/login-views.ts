import type { LoginAttempt, LoginForm, LoginRequest, LoginValues } from './login-inbox';
import type { SiteRow } from './tables';

// 로그인 카드의 모양 (콘솔은 camelCase, MCP는 snake_case). 값(아이디 · 비밀번호 · 인증번호)은
// 러너에게 가는 browser_login_next 한 곳에만 실린다

function attemptOf(a: LoginAttempt | null) {
  return a
    ? {
        status: a.status,
        reason: a.reason,
        afterUrl: a.afterUrl,
        image: a.image,
        /** 간편 로그인 회사의 화면에서 찾은 칸 (종류만). 있으면 카드가 그 칸을 띄운다 */
        provider: a.providerForm
          ? {
              provider: a.providerForm.provider,
              origin: new URL(a.providerForm.page_url).origin,
              fields: a.providerForm.fields.map((f) => ({ kind: f.kind })),
            }
          : null,
        at: a.at.toISOString(),
      }
    : null;
}

/** GET sites/:id/login: 카드에 그릴 칸(종류만)과 진행 상태. 칸이 없으면 화면에서 직접 로그인 */
export class LoginCardView {
  constructor(
    private readonly site: Readonly<SiteRow>,
    private readonly form: LoginForm | null,
    private readonly attempt: LoginAttempt | null,
  ) {}

  toJSON() {
    const form = this.form;
    return {
      siteId: this.site.id,
      siteName: this.site.name,
      /** 값이 갈 곳 (로그인 화면의 출처) */
      origin: form && URL.canParse(form.page_url) ? new URL(form.page_url).origin : null,
      fields: form ? form.fields.map((f) => ({ kind: f.kind })) : null,
      /** 간편 로그인 단추 (2026-11-26): 회사만 */
      social: form ? (form.social ?? []).map((s) => ({ provider: s.provider })) : [],
      trusted: this.site.trusted_at !== null,
      attempt: attemptOf(this.attempt),
    };
  }
}

/** POST sites/:id/login의 답: 넣은 뒤의 진행 상태 */
export class LoginSentView {
  constructor(private readonly attempt: LoginAttempt | null) {}

  toJSON() {
    return { attempt: attemptOf(this.attempt) };
  }
}

/** browser_login_save의 답 */
export class LoginSavedView {
  constructor(private readonly outcome: string) {}

  toJSON() {
    return { saved: true, outcome: this.outcome };
  }
}

/** browser_login_next의 답: 넣을 사이트 · 칸 · 값 (없으면 login: null) */
export class NextLoginView {
  constructor(
    private readonly next: {
      site: Readonly<SiteRow>;
      form: LoginForm;
      values: LoginValues;
      request: LoginRequest;
    } | null,
  ) {}

  toJSON() {
    const n = this.next;
    if (!n) return { login: null };
    const base = {
      kind: n.request.kind,
      site_id: n.site.id,
      site_name: n.site.name,
      origins: n.site.origins,
    };
    if (n.request.kind === 'social') {
      const provider = n.request.provider;
      const button = (n.form.social ?? []).find((s) => s.provider === provider);
      return { login: { ...base, page_url: n.form.page_url, social: button ?? null } };
    }
    // 간편 로그인 회사의 화면이면 그 화면의 주소 · 칸, 아니면 사이트의 로그인 칸
    const form = n.request.kind === 'provider' ? n.request.form : n.form;
    return {
      login: {
        ...base,
        page_url: form.page_url,
        fields: form.fields.map((f) => ({
          kind: f.kind,
          role: f.role,
          name: f.name,
          value: n.values[f.kind] ?? '',
        })),
        submit: form.submit,
      },
    };
  }
}
