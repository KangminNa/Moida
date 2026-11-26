import { RuleViolation } from '../../platform';

/**
 * 커넥터의 로그인 서버 (external_tools.oauth, C1): 비밀이 아닌 값만. client_id · redirect_uri는 동적 등록 뒤에 찬다.
 * scope는 보호된 자원 정보의 scopes_supported를 빈칸으로 이은 것 (없으면 null: 요청에 싣지 않는다)
 */
export type OAuthServer = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string | null;
  scope: string | null;
  client_id: string | null;
  redirect_uri: string | null;
};

// 공식 원격 MCP의 로그인 서버 찾기 (C1, MCP 권한 규격 · OAuth 2.1). 바깥 서버가 준 값이라 믿지 않는 입력으로 거른다.
//   ① 보호된 자원 정보 (RFC 9728): <출처>/.well-known/oauth-protected-resource<MCP 경로> → 뿌리. 없으면 MCP 주소의 출처가 로그인 서버
//   ② 로그인 서버 정보 (RFC 8414 → OIDC): 경로를 끼운 주소 → OIDC 끼운 주소 → OIDC 뒤에 붙인 주소. issuer가 같고 S256을 받아야 한다
//   ③ 동적 등록 (RFC 7591): 공개 클라이언트(token_endpoint_auth_method none)로. 로그인 서버 · 돌아올 주소가 같으면 앞의 등록을 다시 쓴다
// 주소는 https만, 계정 · 조각(#)을 넣은 주소는 받지 않는다. 내부망인지는 부를 때 OAuthGateway가 이름을 풀어 본다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. OAuth 로그인 Service가 쓴다
export class OAuthMetadata {
  static readonly CLIENT_NAME = 'Moida';
  private static readonly URL_MAX = 2000;
  private static readonly SCOPE_MAX = 1000;
  private static readonly CLIENT_ID = /^[\x21-\x7e]{1,500}$/;
  private static readonly SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]{1,200}$/;

  /** ①의 주소들: 경로를 끼운 것 → 뿌리 */
  static resourceUrls(mcpUrl: string): URL[] {
    const url = new URL(mcpUrl);
    const base = `${url.origin}/.well-known/oauth-protected-resource`;
    const path = OAuthMetadata.pathOf(url);
    return (path ? [base + path, base] : [base]).map((u) => new URL(u));
  }

  /** ①의 답 → 로그인 서버(issuer)와 요청할 범위. 답이 없으면 MCP 주소의 출처를 로그인 서버로 본다 */
  static resource(body: unknown, mcpUrl: string): { issuer: string; scope: string | null } {
    const mcp = new URL(mcpUrl);
    if (body === null) return { issuer: mcp.origin, scope: null };
    const found = OAuthMetadata.object(body, '보호된 자원 정보');
    if (found.resource !== undefined && !OAuthMetadata.covers(found.resource, mcp))
      throw new RuleViolation('보호된 자원 정보가 이 MCP 주소의 것이 아니에요');
    const servers = Array.isArray(found.authorization_servers) ? found.authorization_servers : [];
    const issuer =
      servers.length > 0 ? OAuthMetadata.https(servers[0], '로그인 서버 주소') : mcp.origin;
    return { issuer, scope: OAuthMetadata.scopeOf(found.scopes_supported) };
  }

  /** ②의 주소들 */
  static serverUrls(issuer: string): URL[] {
    const url = new URL(issuer);
    const path = OAuthMetadata.pathOf(url);
    const urls = path
      ? [
          `${url.origin}/.well-known/oauth-authorization-server${path}`,
          `${url.origin}/.well-known/openid-configuration${path}`,
          `${url.origin}${path}/.well-known/openid-configuration`,
        ]
      : [
          `${url.origin}/.well-known/oauth-authorization-server`,
          `${url.origin}/.well-known/openid-configuration`,
        ];
    return urls.map((u) => new URL(u));
  }

  /**
   * ②의 답 → 로그인 서버. before는 지금 저장된 로그인 서버(ConnectorLogin.server):
   * 로그인 서버 · 돌아올 주소가 같으면 등록한 client_id를 다시 쓰고, 아니면 비워서 다시 등록하게 한다
   */
  static server(
    body: unknown,
    issuer: string,
    scope: string | null,
    before: OAuthServer | null,
    redirectUri: string,
  ): OAuthServer {
    if (body === null)
      throw new RuleViolation(
        '로그인 서버 정보를 찾지 못했어요. OAuth를 지원하는 MCP인지 확인해요',
      );
    const meta = OAuthMetadata.object(body, '로그인 서버 정보');
    if (
      typeof meta.issuer !== 'string' ||
      OAuthMetadata.trim(meta.issuer) !== OAuthMetadata.trim(issuer)
    )
      throw new RuleViolation('로그인 서버 정보의 issuer가 주소와 맞지 않아요');
    const methods = meta.code_challenge_methods_supported;
    if (!Array.isArray(methods) || !methods.includes('S256'))
      throw new RuleViolation('PKCE(S256)를 지원하지 않는 로그인 서버예요');
    const same = before?.issuer === issuer && before.redirect_uri === redirectUri;
    const registration = meta.registration_endpoint;
    return {
      issuer,
      authorization_endpoint: OAuthMetadata.https(meta.authorization_endpoint, '로그인 주소'),
      token_endpoint: OAuthMetadata.https(meta.token_endpoint, '토큰 주소'),
      registration_endpoint:
        registration === undefined || registration === null
          ? null
          : OAuthMetadata.https(registration, '등록 주소'),
      scope,
      client_id: same && before ? before.client_id : null,
      redirect_uri: same ? redirectUri : null,
    };
  }

  /** ③을 할 주소. 등록 주소가 없으면 이 서버에는 로그인할 수 없다 (클라이언트를 손으로 넣는 칸은 아직 없다) */
  static registrationUrl(server: OAuthServer): URL {
    if (!server.registration_endpoint)
      throw new RuleViolation('자동 등록(동적 클라이언트 등록)을 지원하지 않는 로그인 서버예요');
    return new URL(server.registration_endpoint);
  }

  /** ③의 요청 본문: 공개 클라이언트, 승인 코드 + 갱신 토큰 */
  static registration(server: OAuthServer, redirectUri: string): Record<string, unknown> {
    return {
      client_name: OAuthMetadata.CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(server.scope ? { scope: server.scope } : {}),
    };
  }

  /** ③의 답 → client_id를 채운 로그인 서버. 받은 client_secret은 쓰지 않는다 (공개 클라이언트) */
  static registered(
    server: OAuthServer,
    answer: { status: number; body: unknown },
    redirectUri: string,
  ): OAuthServer {
    const id = (answer.body as { client_id?: unknown } | null)?.client_id;
    if (answer.status < 200 || answer.status >= 300 || typeof id !== 'string')
      throw new RuleViolation(`로그인 서버에 등록하지 못했어요 (HTTP ${answer.status})`);
    if (!OAuthMetadata.CLIENT_ID.test(id))
      throw new RuleViolation('등록 답의 client_id가 틀렸어요');
    return { ...server, client_id: id, redirect_uri: redirectUri };
  }

  /** 저장된 값(external_tools.oauth). 모양이 틀리거나 비었으면 null */
  static stored(value: unknown): OAuthServer | null {
    const v = (value ?? {}) as Partial<Record<keyof OAuthServer, unknown>>;
    const text = (x: unknown) => (typeof x === 'string' && x !== '' ? x : null);
    const issuer = text(v.issuer);
    const authorize = text(v.authorization_endpoint);
    const token = text(v.token_endpoint);
    if (!issuer || !authorize || !token) return null;
    return {
      issuer,
      authorization_endpoint: authorize,
      token_endpoint: token,
      registration_endpoint: text(v.registration_endpoint),
      scope: text(v.scope),
      client_id: text(v.client_id),
      redirect_uri: text(v.redirect_uri),
    };
  }

  /** 받은 주소 하나: https, 계정 · 조각 없음, 2000자까지 */
  static https(value: unknown, what: string): string {
    let url: URL | null = null;
    try {
      url = typeof value === 'string' ? new URL(value) : null;
    } catch {
      url = null;
    }
    if (
      url === null ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      url.href.length > OAuthMetadata.URL_MAX
    )
      throw new RuleViolation(`${what}가 https 주소가 아니에요`);
    return url.href;
  }

  /** scopes_supported → "a b". 틀린 이름은 버리고 1000자까지 */
  private static scopeOf(value: unknown): string | null {
    if (!Array.isArray(value)) return null;
    let joined = '';
    for (const name of new Set(value)) {
      if (typeof name !== 'string' || !OAuthMetadata.SCOPE.test(name)) continue;
      const next = joined ? `${joined} ${name}` : name;
      if (next.length > OAuthMetadata.SCOPE_MAX) break;
      joined = next;
    }
    return joined || null;
  }

  /** 정보의 resource가 이 MCP 주소(또는 그 위의 경로)인가: 같은 출처, MCP 경로가 그 경로로 시작 */
  private static covers(resource: unknown, mcp: URL): boolean {
    if (typeof resource !== 'string') return false;
    try {
      const url = new URL(resource);
      const path = OAuthMetadata.pathOf(url);
      const mine = OAuthMetadata.pathOf(mcp);
      return url.origin === mcp.origin && (mine === path || mine.startsWith(`${path}/`));
    } catch {
      return false;
    }
  }

  private static object(body: unknown, what: string): Record<string, unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw new RuleViolation(`${what}가 JSON 객체가 아니에요`);
    return body as Record<string, unknown>;
  }

  /** 끝의 /를 뺀 경로 (뿌리면 빈 글) */
  private static pathOf(url: URL): string {
    return url.pathname.replace(/\/+$/, '');
  }

  private static trim(value: string): string {
    return value.replace(/\/+$/, '');
  }
}
