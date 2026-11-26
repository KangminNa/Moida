// 로그인 카드의 값 (2026-11-19 사용자 결정, 원칙 8을 바꿈). 관리자가 카드의 칸에 넣은 아이디 · 비밀번호 · 인증번호는
// 이 프로세스(API 서버)의 메모리에만 둔다: DB · 이벤트 · 로그 · 실행 기록 · AI 어디에도 가지 않는다.
// 그 사이트의 로그인 화면을 연 러너(AI 없음)가 browser_login_next로 꺼내 가면 바로 지운다. 꺼내 가지 않으면 10분 뒤에 버린다.
// 서버가 다시 뜨면 사라진다 (카드가 "다시 넣어 주세요"로 보인다). 남는 것은 진행 상태와 로그인 뒤 화면뿐이고, 그것도 10분이다.

/** 카드의 칸 종류 */
export const LOGIN_KINDS = ['id', 'password', 'code'] as const;
export type LoginKind = (typeof LOGIN_KINDS)[number];
export type LoginValues = Partial<Record<LoginKind, string>>;

/**
 * 간편 로그인 회사와 그 회사의 로그인 화면 호스트 (2026-11-26, 고정 목록). 러너의 LoginFormRef.PROVIDERS와 같다.
 * 간편 로그인 단추를 누른 뒤 러너가 이 호스트의 화면에서 찾은 칸만 카드에 띄운다 (AI가 정하지 않는다)
 */
export const LOGIN_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  kakao: ['accounts.kakao.com', 'kauth.kakao.com'],
  naver: ['nid.naver.com'],
  google: ['accounts.google.com'],
  apple: ['appleid.apple.com'],
};

type Target = { role: string; name: string };

/** 사이트에 적는 로그인 칸 (sites.login_form). 값은 없다. 칸이 없으면(간편 로그인만) submit도 null */
export type LoginForm = {
  page_url: string;
  runner_id: string;
  fields: { kind: LoginKind; role: string; name: string }[];
  submit: Target | null;
  /** 간편 로그인 단추 (2026-11-26) */
  social?: ({ provider: string } & Target)[];
};

/** 간편 로그인 단추를 누른 뒤 러너가 그 회사의 화면에서 찾은 칸 (메모리에만, 10분). 아이디 · 비밀번호만 */
export type ProviderForm = {
  provider: string;
  page_url: string;
  fields: { kind: 'id' | 'password'; role: string; name: string }[];
  submit: Target;
};

/** 관리자가 카드에서 한 것: 사이트 칸에 넣기 · 간편 로그인 단추 누르기 · 그 회사의 화면 칸에 넣기 */
export type LoginRequest =
  | { kind: 'values' }
  | { kind: 'social'; provider: string }
  | { kind: 'provider'; form: ProviderForm };

/**
 * sent(넣음, 러너를 기다림) → filling(러너가 꺼내 하는 중) → submitted(로그인 단추를 누름) | opened(간편 로그인 단추를 눌러
 * 그 회사의 화면이 열림, 2026-11-26) | failed. 꺼내 가지 않으면 expired
 */
export type LoginStatus = 'sent' | 'filling' | 'submitted' | 'opened' | 'failed' | 'expired';

/** 카드가 읽는 진행 상태 (값은 없다). opened면 그 회사의 화면에서 찾은 칸(providerForm, 없으면 화면 · 휴대폰에서 마친다) */
export type LoginAttempt = {
  status: LoginStatus;
  reason: string | null;
  afterUrl: string | null;
  image: string | null;
  providerForm: ProviderForm | null;
  at: Date;
};

type Entry = LoginAttempt & {
  spaceId: string;
  siteId: string;
  runnerId: string;
  request: LoginRequest;
  values: LoginValues | null;
  /** 값을 버리는 때 (sent) · 상태를 버리는 때 (그 밖) */
  until: number;
};

export class LoginInbox {
  /** 값을 두는 시간 */
  static readonly KEEP_MS = 10 * 60_000;
  /** 꺼내 간 러너가 결과를 남기지 않으면 실패로 보는 시간 */
  private static readonly FILLING_MS = 2 * 60_000;
  private readonly entries = new Map<string, Entry>();

  /** 관리자가 넣은 값 · 누를 간편 로그인. 같은 사이트의 앞 것은 버린다 */
  send(
    spaceId: string,
    siteId: string,
    runnerId: string,
    values: LoginValues,
    now = Date.now(),
    request: LoginRequest = { kind: 'values' },
  ) {
    this.entries.set(LoginInbox.key(spaceId, siteId), {
      spaceId,
      siteId,
      runnerId,
      request,
      values: { ...values },
      status: 'sent',
      reason: null,
      afterUrl: null,
      image: null,
      providerForm: null,
      at: new Date(now),
      until: now + LoginInbox.KEEP_MS,
    });
  }

  /** 그 사이트에서 지금 열려 있는 간편 로그인 회사의 칸 (opened 뒤, 10분). 없으면 null */
  providerForm(spaceId: string, siteId: string, now = Date.now()): ProviderForm | null {
    const attempt = this.attempt(spaceId, siteId, now);
    return attempt?.status === 'opened' ? attempt.providerForm : null;
  }

  /** 이 러너가 넣을 값 하나를 꺼낸다 (꺼내면 메모리에서 지운다). 없으면 null */
  take(
    spaceId: string,
    runnerId: string,
    now = Date.now(),
  ): { siteId: string; values: LoginValues; request: LoginRequest } | null {
    this.sweep(now);
    for (const entry of this.entries.values()) {
      if (entry.spaceId !== spaceId || entry.runnerId !== runnerId || entry.status !== 'sent')
        continue;
      const values = entry.values ?? {};
      Object.assign(entry, {
        values: null,
        status: 'filling',
        at: new Date(now),
        until: now + LoginInbox.FILLING_MS,
      });
      return { siteId: entry.siteId, values, request: entry.request };
    }
    return null;
  }

  /** 꺼내 간 값을 쓰지 못하고 돌려준다 (사이트의 칸이 지워졌을 때) */
  drop(spaceId: string, siteId: string, reason: string, now = Date.now()): void {
    const entry = this.entries.get(LoginInbox.key(spaceId, siteId));
    if (entry) LoginInbox.end(entry, 'failed', reason, null, null, now, null);
  }

  /** 러너가 남긴 결과. 꺼내 간 그 러너만. 남겼으면 true */
  save(
    spaceId: string,
    siteId: string,
    runnerId: string,
    result: {
      outcome: 'submitted' | 'opened' | 'failed';
      reason: string | null;
      afterUrl: string | null;
      image: string | null;
      providerForm?: ProviderForm | null;
    },
    now = Date.now(),
  ): boolean {
    const entry = this.entries.get(LoginInbox.key(spaceId, siteId));
    if (!entry || entry.runnerId !== runnerId || entry.status !== 'filling') return false;
    // 열림은 간편 로그인 단추를 누른 것에만, 그 회사의 칸은 누른 회사의 것만
    if ((result.outcome === 'opened') !== (entry.request.kind === 'social')) return false;
    const provider = entry.request.kind === 'social' ? entry.request.provider : null;
    const form =
      result.providerForm && result.providerForm.provider === provider ? result.providerForm : null;
    const { outcome, reason, afterUrl, image } = result;
    LoginInbox.end(entry, outcome, reason, afterUrl, image, now, form);
    return true;
  }

  /** 카드가 읽는 진행 상태. 없으면 null */
  attempt(spaceId: string, siteId: string, now = Date.now()): LoginAttempt | null {
    this.sweep(now);
    const entry = this.entries.get(LoginInbox.key(spaceId, siteId));
    if (!entry) return null;
    const { status, reason, afterUrl, image, providerForm, at } = entry;
    return { status, reason, afterUrl, image, providerForm, at };
  }

  /** 값을 버릴 때가 지난 것: 꺼내 가지 않은 값은 expired, 꺼내 간 뒤 결과가 없으면 failed, 끝난 상태는 지운다 */
  private sweep(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.until > now) continue;
      if (entry.status === 'sent')
        LoginInbox.end(
          entry,
          'expired',
          '10분 안에 러너가 가져가지 않았어요',
          null,
          null,
          now,
          null,
        );
      else if (entry.status === 'filling')
        LoginInbox.end(
          entry,
          'failed',
          '러너가 로그인 결과를 남기지 않았어요',
          null,
          null,
          now,
          null,
        );
      else this.entries.delete(key);
    }
  }

  private static end(
    entry: Entry,
    status: LoginStatus,
    reason: string | null,
    afterUrl: string | null,
    image: string | null,
    now: number,
    providerForm: ProviderForm | null,
  ): void {
    Object.assign(entry, {
      values: null,
      status,
      reason,
      afterUrl,
      image,
      providerForm,
      at: new Date(now),
      until: now + LoginInbox.KEEP_MS,
    });
  }

  private static key(spaceId: string, siteId: string): string {
    return `${spaceId}:${siteId}`;
  }
}

// 로그인 카드를 띄울 믿는 출처 (피싱 막기). 페이지에 심은 글이 AI를 가짜 로그인 화면으로 데려가도 칸이 뜨지 않게:
// 관리자가 직접 등록했거나 화면에서 로그인한 사이트(trusted_at)이거나, 관리자가 쓴 지시에 그 도메인이 적혀 있을 때만.
// 도메인은 등록 단위(naver.com, example.co.kr)로 본다: 같은 회사의 로그인 주소(nid.naver.com)가 사이트(blog.naver.com)와 다를 수 있어서다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 로그인 필요 · 카드가 쓴다
export class LoginTrust {
  /** 나라 도메인 아래의 둘째 단계 (co.kr · or.jp …) */
  private static readonly SECOND = new Set([
    'ac',
    'co',
    'com',
    'edu',
    'go',
    'gov',
    'ne',
    'net',
    'or',
    'org',
    're',
  ]);

  /** 등록 단위의 도메인. IP · 한 단어 호스트는 그대로 */
  static domainOf(host: string): string {
    const h = host.toLowerCase().replace(/\.$/, '');
    if (/^[\d.]+$/.test(h) || h.includes(':')) return h;
    const labels = h.split('.');
    const tld = labels.at(-1) ?? '';
    const take =
      labels.length >= 3 && tld.length === 2 && LoginTrust.SECOND.has(labels.at(-2) ?? '') ? 3 : 2;
    return labels.slice(-take).join('.');
  }

  /** 같은 등록 단위인가 */
  static sameDomain(a: string, b: string): boolean {
    return LoginTrust.domainOf(a) === LoginTrust.domainOf(b);
  }

  /** 관리자의 지시에 그 도메인이 적혀 있는가 (앞이 글자 · 숫자가 아니어야: gab.com은 ab.com이 아니다) */
  static mentioned(ownerText: string, host: string): boolean {
    const domain = LoginTrust.domainOf(host).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9-])${domain}($|[^a-z0-9-])`, 'i').test(ownerText);
  }
}
