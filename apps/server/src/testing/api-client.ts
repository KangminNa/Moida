import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { CairnApp } from '../cairn-app';
import { InstallPolicy, ServerRunnerPolicy } from '../modules/account';
import { Database, type RequestLogSink, SecretBox } from '../modules/platform';

/** 테스트에서 요청하는 사람: 쿠키 묶음. 방문자는 쿠키가 없다 */
export class TestUser {
  static readonly visitor = new TestUser({});

  constructor(readonly cookies: Readonly<Record<string, string>>) {}

  with(more: Readonly<Record<string, string>>): TestUser {
    return new TestUser({ ...this.cookies, ...more });
  }

  get header(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
  }
}

/** 응답 하나: 상태 코드, 본문, 머리글 (쿠키, 다른 주소로 보내기) */
export class ApiResult {
  constructor(
    readonly status: number,
    readonly text: string,
    private readonly headers: Headers,
  ) {}

  /** 본문을 JSON으로 (테스트에서 값을 꺼내 비교할 때) */
  json(): Record<string, unknown> {
    return JSON.parse(this.text) as Record<string, unknown>;
  }

  get location(): string | null {
    return this.headers.get('location');
  }

  header(name: string): string | null {
    return this.headers.get(name);
  }

  /** 서버가 새로 준 쿠키 (지운 쿠키는 빈 문자열) */
  cookies(): Record<string, string> {
    const found: Record<string, string> = {};
    for (const line of this.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = (pair ?? '').indexOf('=');
      if (at > 0) found[(pair ?? '').slice(0, at)] = decodeURIComponent((pair ?? '').slice(at + 1));
    }
    return found;
  }
}

// API 테스트 도구: 실제 서버(AppModule)를 테스트 안에서 임의 포트로 띄우고 HTTP로 부른다.
// 로그인은 진짜 흐름 그대로 (설치 코드 → 주인 계정, 또는 아이디·비밀번호 로그인).
//
//   const api = await ApiClient.start();
//   const owner = await api.signIn();
//   const res = await api.get('/api/plugins', owner);
//   assert.equal(res.status, 200);
//   await api.close();
export class ApiClient {
  /** 테스트용 주인 계정 */
  static readonly OWNER_LOGIN = 'owner@example.com';
  static readonly OWNER_PASSWORD = 'test-password-123';

  /**
   * 키를 주지 않았을 때 모든 시험 프로세스가 함께 쓰는 서버 키 (시험 DB 전용).
   * 시험 파일마다 프로세스가 따로지만 시험 DB는 하나다: 프로세스마다 무작위 키를 쓰면 앞 파일이 잠근 값을
   * 뒤 파일의 키 교체(SecretRotation)가 풀지 못한다 (CI에서만 드러났다. 로컬은 .env의 키 하나로 돌았다)
   */
  private static readonly TEST_KEY = createHash('sha256').update('cairn-test-db').digest('base64');

  private constructor(
    private readonly app: INestApplication,
    readonly baseUrl: string,
  ) {}

  /** 운영과 같은 길(CairnApp.api)로 서버를 띄운다. log: 요청 로그를 모아 볼 때 */
  static async start(options: { log?: RequestLogSink } = {}): Promise<ApiClient> {
    // compose는 값이 없으면 빈 문자열로 넘긴다
    process.env.CAIRN_SECRET_KEY ||= ApiClient.TEST_KEY;
    const app = await CairnApp.api({
      port: 0,
      host: '127.0.0.1',
      quiet: true,
      signals: false,
      log: options.log ?? (() => {}),
    });
    return new ApiClient(app, await app.getUrl());
  }

  /** 서버 안의 객체를 꺼낸다 */
  service<T>(type: new (...args: never[]) => T): T {
    return this.app.get(type);
  }

  /** 이 주제의 이벤트 중 처리되지 못한 수 (기다리거나 실패한 것). 받는 쪽이 이벤트를 삼키지 않았는지 볼 때 */
  async unprocessed(topic: string): Promise<number> {
    const [row] = await this.service(Database).sql`
      SELECT count(*) AS n FROM platform.outbox WHERE topic = ${topic} AND processed_at IS NULL`;
    return Number(row?.n);
  }

  installCode(): string {
    return this.service(InstallPolicy).code();
  }

  /** headers: 브라우저가 붙이는 머리글을 흉내 낼 때 (Origin, Sec-Fetch-Site 등) */
  request(
    method: string,
    path: string,
    as: TestUser = TestUser.visitor,
    body?: object,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<ApiResult> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(as.header ? { cookie: as.header } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (res) => new ApiResult(res.status, await res.text(), res.headers));
  }

  get(path: string, as: TestUser = TestUser.visitor): Promise<ApiResult> {
    return this.request('GET', path, as);
  }

  /**
   * Host 머리글을 정해 보내는 요청 (앱 도메인, 스토어 3-0 · 3-1). fetch는 Host를 바꾸지 못해 node:http로 보낸다.
   * forwarded: 앞단 프록시를 거친 요청처럼 X-Forwarded-Host로만 도메인을 싣는다. headers: Origin · Sec-Fetch-Site · CSRF 등
   */
  viaHost(
    path: string,
    host: string,
    options: {
      method?: string;
      as?: TestUser;
      body?: object;
      headers?: Readonly<Record<string, string>>;
      forwarded?: boolean;
    } = {},
  ): Promise<ApiResult> {
    const url = new URL(path, this.baseUrl);
    const as = options.as ?? TestUser.visitor;
    const body = options.body ? JSON.stringify(options.body) : null;
    const headers: Record<string, string> = {
      ...(options.forwarded ? { 'x-forwarded-host': host } : { host }),
      ...(as.header ? { cookie: as.header } : {}),
      // DELETE는 node가 본문을 저절로 나눠 보내지 않아 길이를 적어야 서버가 본문을 읽는다
      ...(body
        ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }
        : {}),
      ...options.headers,
    };
    return new Promise((done, fail) => {
      const req = httpRequest(
        url,
        { method: options.method ?? 'GET', headers, setHost: options.forwarded === true },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const out = new Headers();
            for (const [name, value] of Object.entries(res.headers))
              for (const one of Array.isArray(value) ? value : [value ?? ''])
                out.append(name, String(one));
            done(new ApiResult(res.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'), out));
          });
        },
      );
      req.on('error', fail);
      req.end(body ?? undefined);
    });
  }

  /** form으로 보내기 (OAuth 토큰 요청처럼 application/x-www-form-urlencoded) */
  form(path: string, values: Readonly<Record<string, string>>): Promise<ApiResult> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString(),
    }).then(async (res) => new ApiResult(res.status, await res.text(), res.headers));
  }

  /** MCP 요청 하나 (JSON-RPC). token: 기기의 Bearer 토큰 */
  mcp(token: string | null, method: string, params: object = {}): Promise<ApiResult> {
    return fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }).then(async (res) => new ApiResult(res.status, await res.text(), res.headers));
  }

  /** 설치 코드를 넣는다. 돌려준 사람은 설치 통행증을 가진 브라우저 */
  async beginInstall(): Promise<TestUser> {
    const verified = await this.request('POST', '/api/install/verify', TestUser.visitor, {
      code: this.installCode(),
    });
    if (verified.status !== 200) throw new Error(`설치 코드 확인 실패: ${verified.text}`);
    return new TestUser(verified.cookies());
  }

  /** 메일(전에 만든 계정은 아이디) · 비밀번호 로그인 (응답 그대로) */
  async login(login: string, password: string): Promise<ApiResult> {
    return this.request('POST', '/api/auth/login', TestUser.visitor, { login, password });
  }

  /** 주인으로 로그인한 사람. 아직 설치 전이면 설치(주인 계정 만들기)부터 한다 */
  async signIn(): Promise<TestUser> {
    const status = (await this.get('/api/install')).json();
    const done = status.installed
      ? await this.login(ApiClient.OWNER_LOGIN, ApiClient.OWNER_PASSWORD)
      : await this.request('POST', '/api/install/owner', await this.beginInstall(), {
          email: ApiClient.OWNER_LOGIN,
          password: ApiClient.OWNER_PASSWORD,
        });
    const session = done.cookies().cairn_session;
    if (done.status !== 200 || !session)
      throw new Error(`로그인 실패: ${done.status} ${done.text}`);
    return new TestUser({ cairn_session: session });
  }

  /**
   * 글을 넣을 공개 앱 (스토어 1단계: 앱에 든 글만 공개된다). 주소 blog의 앱을 찾고, 없으면 블로그 앱을 만들어 공개로 바꾼다.
   * 시험이 같은 DB를 함께 써서 찾거나 만든다. 앱 id를 돌려준다
   */
  async blogApp(owner: TestUser): Promise<string> {
    const { apps } = (await this.get('/api/apps', owner)).json() as {
      apps: { id: string; slug: string; visibility: string; version: number }[];
    };
    const found = apps.find((a) => a.slug === 'blog');
    const app =
      found ??
      ((
        await this.request('POST', '/api/apps', owner, {
          requestId: randomUUID(),
          kind: 'blog',
          name: '블로그',
          slug: 'blog',
        })
      ).json() as { id: string; visibility: string; version: number });
    if (app.visibility !== 'public') {
      const res = await this.request('PATCH', `/api/apps/${app.id}`, owner, {
        version: app.version,
        visibility: 'public',
      });
      if (res.status !== 200) throw new Error(`앱을 공개하지 못했어요: ${res.status} ${res.text}`);
    }
    return app.id;
  }

  /**
   * 기기를 연결하고 access 토큰을 돌려준다. AI 도구가 하는 순서 그대로:
   * 스스로 등록 → 승인 요청 → 주인이 승인 화면에서 연결 → 코드를 토큰으로 (PKCE).
   * 사이트 주소(블로그 정보)가 정해져 있어야 한다.
   */
  async connectDevice(owner: TestUser, name: string, scope?: string): Promise<string> {
    const redirect = 'http://localhost:33418/callback';
    const registered = await this.request('POST', '/oauth/register', TestUser.visitor, {
      client_name: 'Claude Code',
      redirect_uris: [redirect],
    });
    const clientId = String(registered.json().client_id);
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'test',
      ...(scope ? { scope } : {}),
    });
    const begin = await this.get(`/oauth/authorize?${query}`);
    const request = new URL(begin.location ?? 'http://x').searchParams.get('request') ?? '';
    const approved = await this.request('POST', '/api/connect/approve', owner, { request, name });
    if (approved.status !== 200) throw new Error(`기기 승인 실패: ${approved.text}`);
    const code = new URL(String(approved.json().redirect)).searchParams.get('code') ?? '';
    const token = await this.form('/oauth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
    });
    if (token.status !== 200) throw new Error(`토큰 받기 실패: ${token.text}`);
    return String(token.json().access_token);
  }

  /**
   * 코드 러너 칸 하나를 연결하고 기기 토큰을 돌려준다 (칸이 하는 그대로: 칸의 연결 값 + 칸 번호).
   * 다른 모듈의 테스트가 칸 기기(run · sandbox)를 쓸 때. 연결 자체는 device.api.test.ts가 본다
   */
  async codeRunner(slot: string): Promise<string> {
    const secret = this.service(ServerRunnerPolicy).codeSecret();
    const paired = await this.request('POST', '/api/devices/code-runner', TestUser.visitor, {
      secret,
      slot,
    });
    if (paired.status !== 200) throw new Error(`코드 러너 칸 연결 실패: ${paired.text}`);
    return String(paired.json().token);
  }

  /**
   * write 권한을 준 기기의 토큰. 관리 일이 이 기기에게도 막히는지 볼 때 쓴다 (`Bearer <토큰>`).
   * 기기 연결이 사이트 주소를 쓰므로 이 서버의 주소로 정한 뒤 연결한다.
   */
  async writeDevice(owner: TestUser, name: string): Promise<string> {
    const space = (await this.get('/api/space')).json() as { name: string; version: number };
    const site = await this.request('PUT', '/api/space', owner, {
      name: space.name || '돌무더기',
      siteUrl: this.baseUrl,
      version: space.version,
    });
    if (site.status !== 200) throw new Error(`사이트 주소 정하기 실패: ${site.text}`);
    const token = await this.connectDevice(owner, name);
    const devices = (await this.get('/api/devices', owner)).json().devices as {
      id: string;
      name: string;
      version: number;
    }[];
    const device = devices.find((d) => d.name === name);
    if (!device) throw new Error(`연결한 기기가 목록에 없어요: ${name}`);
    const granted = await this.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: ['upload', 'read_public', 'write'],
      version: device.version,
    });
    if (granted.status !== 200) throw new Error(`write 권한 주기 실패: ${granted.text}`);
    return token;
  }

  /**
   * 서버에 등록된 HTTP 경로 전부 ("GET /api/posts/:id" 모양, 정렬). 방문자에게 열린 경로를 표로 고정할 때 쓴다.
   * Nest가 경로를 Express(5)의 라우터에 등록하므로 그 목록을 읽는다.
   */
  routes(): readonly string[] {
    const express = this.app.getHttpAdapter().getInstance() as {
      router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
    };
    const found = express.router.stack.flatMap(({ route }) =>
      route
        ? Object.entries(route.methods)
            .filter(([, on]) => on)
            .map(([method]) => `${method.toUpperCase()} ${route.path}`)
        : [],
    );
    return [...new Set(found)].sort();
  }

  async close(): Promise<void> {
    await this.app.close();
  }
}
