/** 로그인 칸 하나: 종류(아이디 · 비밀번호 · 인증번호) · 접근성 역할 · 이름. 값은 없다 */
export class LoginFieldRef {
  constructor(
    readonly kind: 'id' | 'password' | 'code',
    readonly role: string,
    readonly name: string,
  ) {}
}

/** 로그인 칸을 읽지 못함 (모양이 틀림). 로그인 카드를 띄우지 않고 화면에서 직접 로그인으로 */
export class LoginFormProblem extends Error {}

// AI가 본 로그인 화면의 칸 (로그인 카드, 2026-11-19 사용자 결정). browser-stop.json의 form이고 믿지 않는 입력이다:
// 칸은 1~3개, 종류마다 하나, 역할 · 이름은 접근성 트리로 다시 찾을 수 있는 모양만. 값은 여기 없다:
// 관리자가 카드의 칸에 넣은 값은 서버 메모리를 거쳐 AI 없는 러너(LoginRunner)가 이 칸에 넣는다 (원칙 8).
export class LoginFormRef {
  static readonly KINDS = ['id', 'password', 'code'] as const;
  private static readonly ROLE = /^[a-z]{1,40}$/;
  private static readonly NAME_MAX = 200;

  constructor(
    readonly fields: readonly LoginFieldRef[],
    /** 로그인 단추 */
    readonly submit: { role: string; name: string },
  ) {}

  /** 모양을 본다. 없으면 null, 틀리면 LoginFormProblem */
  static parse(raw: unknown): LoginFormRef | null {
    if (raw === undefined || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r.fields) || r.fields.length < 1 || r.fields.length > 3)
      throw new LoginFormProblem('form.fields는 1~3개예요');
    const fields = r.fields.map((f) => {
      const field = (f ?? {}) as Record<string, unknown>;
      const kind = LoginFormRef.KINDS.find((k) => k === field.kind);
      if (!kind) throw new LoginFormProblem('form.fields[].kind는 id · password · code예요');
      const { role, name } = LoginFormRef.target(field, 'form.fields[]');
      return new LoginFieldRef(kind, role, name);
    });
    if (new Set(fields.map((f) => f.kind)).size !== fields.length)
      throw new LoginFormProblem('같은 종류의 칸이 둘이에요');
    const submit = LoginFormRef.target((r.submit ?? {}) as Record<string, unknown>, 'form.submit');
    return new LoginFormRef(fields, submit);
  }

  /** browser-stop.json의 form: 틀리면 버린다 (로그인 필요 결재는 그대로 올라가고 화면에서 직접 로그인한다) */
  static of(raw: unknown): LoginFormRef | null {
    try {
      return LoginFormRef.parse(raw);
    } catch {
      return null;
    }
  }

  /** 서버에 보내는 모양 (browser_login_needed의 form · browser_login_next의 form) */
  toJSON() {
    return {
      fields: this.fields.map((f) => ({ kind: f.kind, role: f.role, name: f.name })),
      submit: this.submit,
    };
  }

  private static target(r: Record<string, unknown>, at: string): { role: string; name: string } {
    const role = typeof r.role === 'string' ? r.role.trim().toLowerCase() : '';
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!LoginFormRef.ROLE.test(role)) throw new LoginFormProblem(`${at}.role이 틀려요`);
    if (name.length === 0 || name.length > LoginFormRef.NAME_MAX)
      throw new LoginFormProblem(`${at}.name은 1~${LoginFormRef.NAME_MAX}자예요`);
    return { role, name };
  }
}
