import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ExternalFailure, RuleViolation } from '../../platform';
import type { OAuthServer } from './oauth-metadata.policy';

/**
 * 로그인 하나를 멈춘 까닭 (C1). 돌아온 화면의 `?oauth_error=`에 이 짧은 이름만 싣고, 문구는 화면이 고른다
 * (주소에 서버의 글을 싣지 않는다: 누가 만든 링크로 콘솔에 아무 글이나 띄우지 못하게)
 */
export class OAuthStop extends RuleViolation {
  /** 지났거나 · 이미 썼거나 · 다른 로그인의 state */
  static readonly STATE = 'state';
  /** 로그인 서버에서 취소 · 거절 */
  static readonly DENIED = 'denied';
  /** 토큰을 받지 못함 (거절 · 바깥 실패 · 그 밖의 오류) */
  static readonly TOKEN = 'token';
  /** 로그인하는 사이 커넥터의 주소 · 방식이 바뀜 */
  static readonly CHANGED = 'changed';

  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }

  static reasonOf(error: unknown): string {
    return error instanceof OAuthStop ? error.reason : OAuthStop.TOKEN;
  }
}

// 승인 코드 + PKCE (C1, OAuth 2.1 · MCP 권한 규격). 로그인 하나 = state(커넥터 id . 무작위)와 검증값(서버에만 둔다).
// 받은 토큰은 묶어서(접근 · 갱신) 서버 키로 잠근다. 러너에는 일할 때 접근 토큰만 Authorization: Bearer로 간다.
// 갱신은 끝나기 10분 전(수명이 짧으면 수명의 절반 전), 갱신 토큰이 없으면 끝나는 때에 "로그인 필요"로 둔다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. OAuth 로그인 Service와 ExternalTool이 쓴다
export class OAuthGrant {
  /** 로그인을 끝내야 하는 시간 (SecretBox.pack의 기간) */
  static readonly LOGIN_SECONDS = 600;
  /** 러너에게 건넬 때 접근 토큰에 남아 있어야 할 시간 */
  static readonly HAND_MS = 60_000;
  /** 갱신이 잠깐 실패했을 때(로그인 서버가 답하지 못함) 다시 해 보는 간격 */
  static readonly RETRY_MS = 5 * 60_000;
  private static readonly REFRESH_BEFORE_MS = 10 * 60_000;
  private static readonly EXPIRES_MAX_S = 366 * 24 * 3600;
  private static readonly ERROR_MAX = 300;
  /** 싼 값의 용도 앞부분 (뒤에 커넥터 id): 다른 커넥터 · 다른 자리에서 싼 값으로 풀리지 않게 */
  private static readonly PURPOSE = 'external-tool-oauth';
  private static readonly STATE =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;
  private static readonly TOKEN = /^[\x21-\x7e]{1,8000}$/;
  private static readonly ERROR_CODE = /^[a-z_]{1,40}$/;

  /** 새 로그인: state(커넥터 id + 무작위 32바이트)와 PKCE 검증값(무작위 32바이트, 43자) */
  static begin(toolId: string): { state: string; verifier: string } {
    return {
      state: `${toolId}.${randomBytes(32).toString('base64url')}`,
      verifier: randomBytes(32).toString('base64url'),
    };
  }

  /** 기다리는 로그인을 쌀 때의 용도 (SecretBox.pack) */
  static purposeOf(toolId: string): string {
    return `${OAuthGrant.PURPOSE}:${toolId}`;
  }

  /** 기다리는 로그인을 쌀 글: state와 검증값 */
  static pending(state: string, verifier: string): string {
    return `${state} ${verifier}`;
  }

  /** 푼 글에서 이 state의 검증값. 없거나 다르면 null */
  static verifierOf(opened: string | null, state: string): string | null {
    const [kept, verifier] = (opened ?? '').split(' ');
    if (!kept || !verifier || kept.length !== state.length) return null;
    return timingSafeEqual(Buffer.from(kept), Buffer.from(state)) ? verifier : null;
  }

  /** state가 가리키는 커넥터 id. 모양이 틀리면 null */
  static toolOf(state: string): string | null {
    return OAuthGrant.STATE.exec(state)?.[1] ?? null;
  }

  /** PKCE S256: base64url(sha256(검증값)) */
  static challenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  /** 로그인 서버로 보낼 주소 (브라우저가 연다): 승인 코드 · client_id · 돌아올 주소 · PKCE · state · resource(RFC 8707) · scope */
  static authorizeUrl(
    server: OAuthServer,
    state: string,
    verifier: string,
    resource: string,
  ): string {
    const url = new URL(server.authorization_endpoint);
    const params: [string, string | null][] = [
      ['response_type', 'code'],
      ['client_id', server.client_id],
      ['redirect_uri', server.redirect_uri],
      ['code_challenge', OAuthGrant.challenge(verifier)],
      ['code_challenge_method', 'S256'],
      ['state', state],
      ['resource', resource],
      ['scope', server.scope],
    ];
    for (const [key, value] of params) if (value !== null) url.searchParams.set(key, value);
    return url.href;
  }

  /** 받은 승인 코드를 토큰으로 바꾸는 요청 (토큰 주소에 폼으로) */
  static codeForm(
    server: OAuthServer,
    code: string,
    verifier: string,
    resource: string,
  ): URLSearchParams {
    return new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: server.redirect_uri ?? '',
      client_id: server.client_id ?? '',
      code_verifier: verifier,
      resource,
    });
  }

  /** 갱신 토큰으로 새 접근 토큰을 받는 요청 */
  static refreshForm(server: OAuthServer, refresh: string, resource: string): URLSearchParams {
    return new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: server.client_id ?? '',
      resource,
    });
  }

  /** 돌아온 iss(RFC 9207)가 있으면 로그인을 시작한 서버여야 한다 (다른 서버의 답을 섞지 않게) */
  static assertIssuer(server: OAuthServer, iss: string | null): void {
    if (iss !== null && iss.replace(/\/+$/, '') !== server.issuer.replace(/\/+$/, ''))
      throw new OAuthStop(OAuthStop.STATE, '다른 로그인 서버의 답이에요. 처음부터 다시 로그인해요');
  }

  /**
   * 토큰 답 → 잠글 묶음(JSON) · 접근 토큰이 끝나는 때 · 일꾼이 다시 볼 때.
   * 거절(4xx · 모양이 틀린 답)은 RuleViolation, 로그인 서버가 답하지 못함(5xx · 429)은 ExternalFailure.
   * 갱신 답에 새 갱신 토큰이 없으면 쓰던 것(kept)을 둔다
   */
  static tokens(
    answer: { status: number; body: unknown },
    kept: string | null,
    now: Date,
  ): { bundle: string; expiresAt: Date | null; refreshAt: Date | null } {
    const body = (answer.body ?? {}) as Record<string, unknown>;
    if (answer.status >= 500 || answer.status === 429)
      throw new ExternalFailure(`로그인 서버가 답하지 못했어요 (HTTP ${answer.status})`);
    if (answer.status !== 200) {
      const code = typeof body.error === 'string' && OAuthGrant.ERROR_CODE.test(body.error);
      throw new RuleViolation(
        `로그인 서버가 토큰을 주지 않았어요 (${code ? body.error : `HTTP ${answer.status}`})`,
      );
    }
    const access = body.access_token;
    const type = body.token_type;
    if (typeof access !== 'string' || !OAuthGrant.TOKEN.test(access))
      throw new RuleViolation('토큰 답에 접근 토큰이 없어요');
    if (type !== undefined && (typeof type !== 'string' || type.toLowerCase() !== 'bearer'))
      throw new RuleViolation('Bearer 토큰이 아니에요');
    const sent = body.refresh_token;
    const refresh = typeof sent === 'string' && OAuthGrant.TOKEN.test(sent) ? sent : kept;
    const expiresAt = OAuthGrant.expiresAt(body.expires_in, now);
    return {
      bundle: JSON.stringify({ access, refresh }),
      expiresAt,
      refreshAt: OAuthGrant.refreshAt(expiresAt, refresh !== null, now),
    };
  }

  /** 잠근 묶음의 접근 토큰 */
  static accessOf(bundle: string): string {
    return String((JSON.parse(bundle) as { access?: unknown }).access ?? '');
  }

  /** 잠근 묶음의 갱신 토큰 (없으면 null) */
  static refreshOf(bundle: string): string | null {
    const refresh = (JSON.parse(bundle) as { refresh?: unknown }).refresh;
    return typeof refresh === 'string' ? refresh : null;
  }

  /** 저장할 실패 까닭: 한 줄, 300자. 서버가 만든 글만 들어온다 (바깥 답의 본문은 싣지 않는다) */
  static errorOf(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.replace(/\s+/g, ' ').trim().slice(0, OAuthGrant.ERROR_MAX) || '로그인하지 못했어요';
  }

  /** 다시 볼 때: 갱신 토큰이 있으면 끝나기 10분 전(수명의 절반보다 앞서지 않게), 없으면 끝나는 때. 끝을 모르면 없음 */
  private static refreshAt(expiresAt: Date | null, refreshable: boolean, now: Date): Date | null {
    if (expiresAt === null) return null;
    if (!refreshable) return expiresAt;
    const life = expiresAt.getTime() - now.getTime();
    return new Date(expiresAt.getTime() - Math.min(OAuthGrant.REFRESH_BEFORE_MS, life / 2));
  }

  private static expiresAt(value: unknown, now: Date): Date | null {
    const seconds = typeof value === 'string' ? Number(value) : value;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(now.getTime() + Math.min(seconds, OAuthGrant.EXPIRES_MAX_S) * 1000);
  }
}
