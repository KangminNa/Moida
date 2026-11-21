import { RuleViolation, SealedSecret, type SecretBox, TableEntity } from '../../platform';
import type { ExternalToolNew, ExternalToolRow } from '../task.tables';
import { ExternalTool } from './external-tool';
import { OAuthGrant, OAuthStop } from './oauth-grant.policy';
import { OAuthMetadata, type OAuthServer } from './oauth-metadata.policy';

// 커넥터 하나의 OAuth 로그인 (C1, task.external_tools의 로그인 칸: oauth · oauth_pending · token* · oauth_error).
// 커넥터(ExternalTool)와 같은 줄이지만 관리자의 고치기와 겨루지 않게 버전 없이 따로 적는다
// (ExternalToolRepository.lockLogin · saveLogin. 러너가 적는 catalog · checked_at과 같다).
//   시작: 찾은 로그인 서버와 state · 검증값을 싼 값(10분) → 돌아옴: state를 맞춰 보고 한 번 꺼냄 → 연결: 토큰을 잠금
//   → 갱신(일꾼): 새 토큰 · 잠깐 실패면 다시 · 거절이나 끝남이면 토큰을 지워 "로그인 필요"
// 갱신하는 사이 다른 쪽(다시 로그인 · 주소 바꿈 · 다른 갱신)이 토큰을 바꿨으면 늦게 온 결과는 버린다 (잠근 토큰의 nonce로 본다)
export class ConnectorLogin extends TableEntity<ExternalToolRow, ExternalToolNew> {
  static restore(row: ExternalToolRow): ConnectorLogin {
    return new ConnectorLogin(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  /** MCP 주소 = 토큰을 쓸 자원 (RFC 8707 resource) */
  get url(): string {
    return this.row.url;
  }

  /** 시작할 때 찾은 로그인 서버 · 등록한 클라이언트. 아직 없으면 null */
  get server(): OAuthServer | null {
    return OAuthMetadata.stored(this.row.oauth);
  }

  /** OAuth 로그인 커넥터여야 한다 (로그인 서버를 찾기 전에) */
  assertOAuth(): void {
    if (this.row.auth !== ExternalTool.OAUTH)
      throw new RuleViolation('OAuth 로그인 커넥터가 아니에요. 로그인 방식을 먼저 바꿔요');
  }

  /**
   * 로그인을 시작한다: 찾은 로그인 서버를 적고 state · 검증값을 싼 값(pending)을 둔다. 기다리던 앞 로그인은 버린다.
   * url은 로그인 서버를 찾은 MCP 주소: 그사이 주소를 바꿨으면 멈춘다
   */
  begin(url: string, server: OAuthServer, pending: string): void {
    this.assertOAuth();
    if (this.row.url !== url)
      throw new RuleViolation('로그인 서버를 찾는 사이 주소가 바뀌었어요. 다시 해요');
    if (!server.client_id || !server.redirect_uri)
      throw new RuleViolation('로그인 서버에 등록하지 않았어요');
    this.put('oauth', server);
    this.put('oauth_pending', pending);
  }

  /**
   * 돌아온 state를 맞춰 보고 검증값을 꺼낸다. 한 번만: 꺼내면 지운다.
   * 다른 state · 10분 지남 · 이미 씀 · 다른 커넥터에서 싼 값이면 OAuthStop(state)
   */
  take(box: SecretBox, state: string, now: Date): { verifier: string; server: OAuthServer } {
    const opened = box.unpack(OAuthGrant.purposeOf(this.id), this.row.oauth_pending, now);
    const verifier = OAuthGrant.verifierOf(opened, state);
    const server = this.server;
    if (verifier === null || this.row.auth !== ExternalTool.OAUTH || server === null)
      throw new OAuthStop(
        OAuthStop.STATE,
        '지났거나 이미 쓴 로그인이에요. 처음부터 다시 로그인해요',
      );
    this.put('oauth_pending', null);
    return { verifier, server };
  }

  /** 로그인이 끝났다: 토큰을 잠가 두고 확인을 다시 맡긴다(updated_at). 그사이 주소 · 방식을 바꿨으면 버린다 */
  connect(
    url: string,
    sealed: SealedSecret,
    expiresAt: Date | null,
    refreshAt: Date | null,
    now: Date,
  ): void {
    if (this.row.auth !== ExternalTool.OAUTH || this.row.url !== url)
      throw new OAuthStop(
        OAuthStop.CHANGED,
        '로그인하는 사이 커넥터가 바뀌었어요. 다시 로그인해요',
      );
    this.putToken(sealed, expiresAt, refreshAt);
    this.put('updated_at', now);
  }

  /** 돌아온 뒤 로그인을 끝내지 못했다: 까닭만 남긴다 (쥐고 있던 토큰은 그대로) */
  failed(error: unknown): void {
    this.put('oauth_error', OAuthGrant.errorOf(error));
  }

  /** 잠근 갱신 토큰 (일꾼의 갱신에만). 없으면 null */
  refreshToken(box: SecretBox): string | null {
    const { token, token_nonce: nonce } = this.row;
    return token && nonce ? OAuthGrant.refreshOf(box.open(new SealedSecret(token, nonce))) : null;
  }

  /** 갱신한 토큰. before는 갱신을 시작할 때 읽은 줄. 그사이 토큰이 바뀌었으면 버린다. 적었으면 true */
  refreshed(
    before: ConnectorLogin,
    sealed: SealedSecret,
    expiresAt: Date | null,
    refreshAt: Date | null,
  ): boolean {
    if (!this.sameToken(before)) return false;
    this.putToken(sealed, expiresAt, refreshAt);
    return true;
  }

  /**
   * 갱신하지 못했다. 로그인 서버가 거절했거나(final) 접근 토큰이 곧 끝나면 토큰을 지워 "로그인 필요"로 두고
   * (러너에게 건네지 않는다), 아니면 RETRY_MS 뒤(늦어도 끝나는 때) 다시 해 본다. 적었으면 true
   */
  refreshFailed(before: ConnectorLogin, error: unknown, final: boolean, now: Date): boolean {
    if (!this.sameToken(before)) return false;
    const until = this.row.token_expires_at?.getTime() ?? null;
    if (final || until === null || until <= now.getTime() + OAuthGrant.HAND_MS) {
      this.put('token', null);
      this.put('token_nonce', null);
      this.put('token_expires_at', null);
      this.put('token_refresh_at', null);
    } else {
      const retry = Math.min(now.getTime() + OAuthGrant.RETRY_MS, until);
      this.put('token_refresh_at', new Date(retry));
    }
    this.put('oauth_error', OAuthGrant.errorOf(error));
    return true;
  }

  private sameToken(before: ConnectorLogin): boolean {
    const [mine, theirs] = [this.row.token_nonce, before.row.token_nonce];
    return this.row.auth === ExternalTool.OAUTH && !!mine && !!theirs && mine.equals(theirs);
  }

  private putToken(sealed: SealedSecret, expiresAt: Date | null, refreshAt: Date | null): void {
    this.put('token', sealed.ciphertext);
    this.put('token_nonce', sealed.nonce);
    this.put('token_expires_at', expiresAt);
    this.put('token_refresh_at', refreshAt);
    this.put('oauth_error', null);
  }
}
