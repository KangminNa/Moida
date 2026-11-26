import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database, OutboxWorker, ZipFile } from '../modules/platform';
import { type ApiClient, type ApiResult, TestUser } from './api-client';
import { TestMailbox } from './test-mailbox';

// 커뮤니티 API 테스트 도구 (스토어 3-1): 공개된 커뮤니티 앱 하나와 그 도메인, 그 도메인으로 보내는 요청, 회원 만들기.
// 가입 제한이 곳(IP)마다라 가입마다 X-Forwarded-For로 다른 곳을 싣는다 (테스트는 앞단 프록시로 믿는 127.0.0.1에서 온다).
// 쓰기는 이 도메인의 화면에서 보낸 것처럼 Origin과 그 회원의 CSRF 값을 붙인다
export class CommunitySite {
  private static places = 0;
  /** 띄운 서버마다 메일함 하나 (인증코드를 받는다) */
  private static readonly boxes = new WeakMap<ApiClient, TestMailbox>();
  /** 가입 비밀번호 (회원 테스트가 로그인할 때 쓴다) */
  static readonly PASSWORD = '오늘은 비가 와서 집에 있다';

  /** 이 서버의 테스트 메일함 (처음 부르면 붙인다) */
  static mailbox(api: ApiClient): TestMailbox {
    const found = CommunitySite.boxes.get(api);
    if (found) return found;
    const box = TestMailbox.install(api);
    CommunitySite.boxes.set(api, box);
    return box;
  }

  /** 회원 테스트의 메일 주소 (이름 → 이름@example.com) */
  static emailOf(name: string): string {
    return `${name.toLowerCase()}@example.com`;
  }
  /** 도메인을 연결하지 않은 앱에 버전만 올려 보는 도구 (deploy만 쓴다) */
  static readonly Probe = class extends CommunitySite {
    constructor(api: ApiClient, appId: string) {
      super(api, '', appId);
    }
  };

  protected constructor(
    protected readonly api: ApiClient,
    readonly host: string,
    readonly appId: string,
  ) {}

  /** 공개된 커뮤니티 앱 하나 (도메인은 모든 공간에서 하나라 부르는 쪽이 이 실행의 표시를 붙인다) */
  /**
   * 가입할 때 동의하는 약관 버전: 공통 약관(스토어, 테스트 서버마다 처음 link가 공개)과 이 앱의 약관(link가 공개).
   * 테스트는 한 DB · 한 공간을 함께 쓴다: 공통 약관의 새 버전을 올리는 테스트는 끝에 되돌릴 수 없으니 버전을 직접 읽는다
   */
  static readonly AGREED = {
    termsVersion: 1,
    privacyVersion: 1,
    appTermsVersion: 1,
    appPrivacyVersion: 1,
  };

  static async open(api: ApiClient, owner: TestUser, slug: string): Promise<CommunitySite> {
    const host = `${slug}.example.com`;
    const made = await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind: 'community',
      name: `커뮤니티 ${slug}`,
      slug,
    });
    assert.equal(made.status, 201, made.text);
    const app = await CommunitySite.link(api, owner, made.json(), host, true);
    return new CommunitySite(api, host, String(app.id));
  }

  /**
   * 회원 · 표를 선언한 공개 페이지 앱 하나 (앱 플랫폼, 스토어 12장): 선언서(cairn.json)가 든 정적 앱 코드를 올리고
   * 도메인을 연결해 공개한 뒤, 일꾼을 돌려 선언한 표를 맞춘다. 파일은 index.html 하나와 선언서
   */
  static async openPage(
    api: ApiClient,
    owner: TestUser,
    slug: string,
    manifest: object,
  ): Promise<CommunitySite> {
    const host = `${slug}.example.com`;
    const made = await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind: 'page',
      name: `앱 ${slug}`,
      slug,
    });
    assert.equal(made.status, 201, made.text);
    const site = new CommunitySite(api, host, String(made.json().id));
    const app = await site.deploy(owner, manifest);
    await CommunitySite.link(api, owner, app, host, true);
    return site;
  }

  /**
   * 앱 코드의 새 버전을 올린다 (관리자의 zip 올리기). 공개 앱이면 그 버전을 바로 공개하고, 일꾼을 돌려 표를 맞춘다.
   * 답은 앱의 마지막 모습. 올리기가 거절되면 그 응답을 던지지 않고 status로 돌려준다 (expect로 받는다)
   */
  async deploy(owner: TestUser, manifest: object, expect = 201): Promise<Record<string, unknown>> {
    const appOf = async () => {
      const list = (await this.api.get('/api/apps', owner)).json().apps as Record<
        string,
        unknown
      >[];
      return list.find((a) => a.id === this.appId) as Record<string, unknown>;
    };
    const zip = new ZipFile();
    zip.add('index.html', '<!doctype html><html><head></head><body>앱</body></html>');
    zip.add('cairn.json', JSON.stringify({ cairn: 1, render: 'static', ...manifest }));
    const before = await appOf();
    const res = await fetch(
      `${this.api.baseUrl}/api/apps/${this.appId}/code/versions?version=${before.version}&note=test`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/zip', cookie: owner.header ?? '' },
        body: zip.toBuffer(),
      },
    );
    const text = await res.text();
    assert.equal(res.status, expect, text);
    if (res.status !== 201) return { status: res.status, text };
    const state = JSON.parse(text) as { version: number; pending: number | null };
    if (state.pending !== null) {
      const shown = await this.api.request('POST', `/api/apps/${this.appId}/code/current`, owner, {
        version: state.version,
        seq: state.pending,
      });
      assert.equal(shown.status, 200, shown.text);
    }
    const worker = this.api.service(OutboxWorker);
    while ((await worker.tick()) > 0);
    return appOf();
  }

  /**
   * 앱에 도메인을 정하고 그 도메인의 확인 값으로 연결을 확인한다. open이면 그 뒤에 공개한다
   * (커뮤니티는 연결을 확인한 도메인이 있어야 공개된다, 스토어 3-2). 답은 앱의 마지막 모습
   */
  static async link(
    api: ApiClient,
    owner: TestUser,
    app: Record<string, unknown>,
    host: string,
    open: boolean,
  ): Promise<Record<string, unknown>> {
    const expect = async (res: Promise<ApiResult>) => {
      const done = await res;
      assert.equal(done.status, 200, done.text);
      return done.json();
    };
    // 공통 약관(스토어)이 없으면 공개한다: 공개 전이면 가입을 받지 않는다 (2026-11-26). 다른 테스트가 먼저 올렸으면 그대로
    const store = (await api.get('/api/community/admin/terms', owner)).json().items as {
      kind: string;
      current: unknown;
    }[];
    for (const line of store.filter((l) => l.current === null)) {
      const res = await api.request('POST', `/api/community/admin/terms/${line.kind}`, owner, {
        version: 0,
        body: `# 공통 ${line.kind}\n\n테스트 약관`,
      });
      assert.ok(res.status === 201 || res.status === 409, res.text);
    }
    // 이 앱의 약관 둘도 공개한다. 가입은 CommunitySite.AGREED에 동의한다
    for (const kind of ['terms', 'privacy']) {
      const published = await api.request(
        'POST',
        `/api/community/admin/${app.id}/terms/${kind}`,
        owner,
        { version: 0, body: `# ${kind}\n\n테스트 약관` },
      );
      assert.equal(published.status, 201, published.text);
    }
    const set = await expect(
      api.request('PATCH', `/api/apps/${app.id}`, owner, { version: app.version, domain: host }),
    );
    const { token } = await expect(api.viaHost('/.well-known/cairn-domain', host));
    const checked = await expect(
      api.request('POST', `/api/apps/${app.id}/domain/check`, owner, {
        version: set.version,
        token,
      }),
    );
    if (!open) return checked;
    return expect(
      api.request('PATCH', `/api/apps/${app.id}`, owner, {
        version: checked.version,
        visibility: 'public',
      }),
    );
  }

  get origin(): string {
    return `http://${this.host}`;
  }

  /** 이 앱 도메인으로 보내는 요청 (쓰기에는 Origin) */
  at(
    path: string,
    options: {
      method?: string;
      as?: TestUser;
      body?: object;
      headers?: Record<string, string>;
    } = {},
  ): Promise<ApiResult> {
    const write = (options.method ?? 'GET') !== 'GET';
    return this.api.viaHost(path, this.host, {
      ...options,
      headers: { ...(write ? { origin: this.origin } : {}), ...options.headers },
    });
  }

  /** 회원의 쓰기: Origin과 그 회원의 CSRF 값을 붙인다 */
  async write(as: TestUser, method: string, path: string, body?: object): Promise<ApiResult> {
    const csrf = String((await this.at('/api/community/me', { as })).json().csrf);
    return this.at(path, { method, as, body, headers: { 'x-cairn-csrf': csrf } });
  }

  /**
   * 가입한 회원의 브라우저 (메일 인증 가입: 코드 받기 → 테스트 메일함의 코드로 가입). 메일은 emailOf(name).
   * ready면 가입 직후 대기(5분)가 지난 것처럼 가입한 때를 앞으로 당긴다 (테스트에서 5분을 기다리지 않으려고 DB에 바로 쓴다)
   */
  async member(name: string, nickname: string, ready = true): Promise<TestUser> {
    const email = CommunitySite.emailOf(name);
    const res = await CommunitySite.join(this.api, this.host, { email, nickname });
    let user: TestUser;
    if (res.status === 201) user = new TestUser(res.cookies());
    else {
      // 같은 메일의 계정이 이미 있다 (다른 앱에서 가입): 로그인하고 이 앱에 참여한다
      assert.match(res.text, /인증코드/, res.text);
      user = await this.enter(email, nickname);
    }
    if (ready)
      await this.api.service(Database).sql`
        UPDATE community.members SET joined_at = joined_at - interval '10 minutes'
        WHERE app_id = ${this.appId}
          AND account_id = (SELECT id FROM community.accounts WHERE email = ${email})`;
    return user;
  }

  /** 이미 있는 계정으로 이 앱 도메인에 로그인하고 이 앱에 참여한다 (스토어 계정, 2026-11-26) */
  async enter(login: string, nickname: string): Promise<TestUser> {
    const signed = await this.at('/api/community/login', {
      method: 'POST',
      body: { login, password: CommunitySite.PASSWORD },
      headers: { 'x-forwarded-for': CommunitySite.nextPlace() },
    });
    assert.equal(signed.status, 200, signed.text);
    const user = new TestUser(signed.cookies());
    const { termsVersion, privacyVersion, ...app } = CommunitySite.AGREED;
    const entered = await this.write(user, 'POST', '/api/community/enter', { nickname, ...app });
    assert.equal(entered.status, 201, entered.text);
    return user;
  }

  /** 테스트 메일의 아이디 (메일의 @ 앞을 아이디 규칙에 맞게: 영문 소문자로 시작하는 4~20자) */
  static loginIdOf(email: string): string {
    const local = (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return `u${local}`.padEnd(4, '_').slice(0, 20);
  }

  /** 가입 시도 한 번: 그 메일로 코드를 받고(받지 못하면 code로 준 값) 가입한다. 곳(IP)은 매번 다르게 (가입 제한) */
  static async join(
    api: ApiClient,
    host: string,
    body: { email: string; code?: string; [key: string]: unknown },
    ip = CommunitySite.nextPlace(),
  ): Promise<ApiResult> {
    const box = CommunitySite.mailbox(api);
    const headers = { origin: `http://${host}`, 'x-forwarded-for': ip };
    let code = body.code;
    let known = false;
    if (code === undefined) {
      const sent = await api.viaHost('/api/community/join/code', host, {
        method: 'POST',
        body: { email: body.email },
        headers,
      });
      assert.equal(sent.status, 204, sent.text);
      const address = String(body.email).trim().toLowerCase();
      known = /이미 가입한/.test(box.to(address).at(-1)?.subject ?? '');
      code = known ? '000000' : box.codeFor(address);
    }
    return api.viaHost('/api/community/join', host, {
      method: 'POST',
      body: {
        password: CommunitySite.PASSWORD,
        ageConfirmed: true,
        loginId: CommunitySite.loginIdOf(String(body.email)),
        ...CommunitySite.AGREED,
        ...body,
        code,
      },
      headers,
    });
  }

  /** 가입마다 다른 곳 (가입 · 코드 보내기 제한이 곳마다라서) */
  static nextPlace(): string {
    CommunitySite.places += 1;
    const n = CommunitySite.places;
    return `10.30.${Math.floor(n / 250)}.${(n % 250) + 1}`;
  }
}
