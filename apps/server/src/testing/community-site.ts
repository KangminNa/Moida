import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../modules/platform';
import { type ApiClient, type ApiResult, TestUser } from './api-client';

// 커뮤니티 API 테스트 도구 (스토어 3-1): 공개된 커뮤니티 앱 하나와 그 도메인, 그 도메인으로 보내는 요청, 회원 만들기.
// 가입 제한이 곳(IP)마다라 가입마다 X-Forwarded-For로 다른 곳을 싣는다 (테스트는 앞단 프록시로 믿는 127.0.0.1에서 온다).
// 쓰기는 이 도메인의 화면에서 보낸 것처럼 Origin과 그 회원의 CSRF 값을 붙인다
export class CommunitySite {
  private static places = 0;

  private constructor(
    private readonly api: ApiClient,
    readonly host: string,
    readonly appId: string,
  ) {}

  /** 공개된 커뮤니티 앱 하나 (도메인은 모든 공간에서 하나라 부르는 쪽이 이 실행의 표시를 붙인다) */
  static async open(api: ApiClient, owner: TestUser, slug: string): Promise<CommunitySite> {
    const host = `${slug}.example.com`;
    const made = await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind: 'community',
      name: `커뮤니티 ${slug}`,
      slug,
    });
    assert.equal(made.status, 201, made.text);
    const app = made.json();
    const opened = await api.request('PATCH', `/api/apps/${app.id}`, owner, {
      version: app.version,
      domain: host,
      visibility: 'public',
    });
    assert.equal(opened.status, 200, opened.text);
    return new CommunitySite(api, host, String(app.id));
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
      body: { loginId, password: '오늘은 비가 와서 집에 있다', nickname, ageConfirmed: true },
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
