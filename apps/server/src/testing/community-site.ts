import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database, OutboxWorker, ZipFile } from '../modules/platform';
import { type ApiClient, type ApiResult, TestUser } from './api-client';

// 커뮤니티 API 테스트 도구 (스토어 3-1): 공개된 커뮤니티 앱 하나와 그 도메인, 그 도메인으로 보내는 요청, 회원 만들기.
// 가입 제한이 곳(IP)마다라 가입마다 X-Forwarded-For로 다른 곳을 싣는다 (테스트는 앞단 프록시로 믿는 127.0.0.1에서 온다).
// 쓰기는 이 도메인의 화면에서 보낸 것처럼 Origin과 그 회원의 CSRF 값을 붙인다
export class CommunitySite {
  private static places = 0;
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
  /** link가 공개하는 약관의 버전 (가입할 때 동의하는 값) */
  static readonly AGREED = { termsVersion: 1, privacyVersion: 1 };

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
    // 약관 둘을 먼저 공개한다: 공개 전이면 가입을 받지 않는다 (3-4). 가입은 CommunitySite.AGREED에 동의한다
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
   * 가입한 회원의 브라우저. ready면 가입 직후 대기(5분)가 지난 것처럼 가입한 때를 앞으로 당긴다
   * (테스트에서 5분을 기다리지 않으려고 DB에 바로 쓴다)
   */
  async member(loginId: string, nickname: string, ready = true): Promise<TestUser> {
    CommunitySite.places += 1;
    const n = CommunitySite.places;
    const res = await this.at('/api/community/join', {
      method: 'POST',
      body: {
        loginId,
        password: '오늘은 비가 와서 집에 있다',
        nickname,
        ageConfirmed: true,
        ...CommunitySite.AGREED,
      },
      headers: { 'x-forwarded-for': `10.30.${Math.floor(n / 250)}.${(n % 250) + 1}` },
    });
    assert.equal(res.status, 201, res.text);
    if (ready)
      await this.api.service(Database).sql`
        UPDATE community.members SET joined_at = joined_at - interval '10 minutes'
        WHERE app_id = ${this.appId} AND login_id = ${loginId}`;
    return new TestUser(res.cookies());
  }
}
