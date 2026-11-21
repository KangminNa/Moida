import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseService,
  Database,
  DomainError,
  HostGate,
  NotFound,
  RuleViolation,
  type SealedSecret,
  SecretBox,
  type VersionInput,
} from '../../platform';
import type { ConnectorLogin } from './connector-login';
import { ExternalTool } from './external-tool';
import type { OAuthCallbackInput } from './external-tool.input';
import { ExternalToolRepository } from './external-tool.repository';
import { OAuthStartView } from './external-tool.view';
import { OAuthGateway } from './oauth.gateway';
import { OAuthGrant, OAuthStop } from './oauth-grant.policy';
import { OAuthMetadata, type OAuthServer } from './oauth-metadata.policy';

// OAuth 커넥터의 로그인 (C1, docs/MCP.md 8장). 바깥 호출 패턴: 짧은 트랜잭션 · 트랜잭션 밖에서 로그인 서버 · 짧은 트랜잭션.
//   시작(관리자): 로그인 서버 찾기 · 동적 등록(밖) → 찾은 값과 state · 검증값을 싼 값을 적는다(안) → 브라우저가 열 로그인 주소
//   돌아옴(관리자의 브라우저): state를 맞춰 보고 한 번 꺼낸다(안) → 승인 코드를 토큰으로(밖) → 잠가 적는다(안)
//   갱신(일꾼): 때가 된 로그인을 읽고(잠그지 않음) → 갱신(밖) → 그사이 토큰이 바뀌지 않았으면 적는다(안, 잠금)
// 마감 작업은 일꾼 안에서 이름마다 하나씩 돈다 (OutboxWorker.runDue): 같은 갱신 토큰을 두 번 쓰지 않는다.
// 로그인 칸은 버전 없이 적는다 (ExternalToolRepository.saveLogin). 토큰 · 검증값 · 승인 코드는 로그 · 이벤트 · View에 싣지 않는다
@Injectable()
export class ExternalToolOAuthService extends BaseService {
  /** 돌아올 주소의 경로 (사이트 주소 뒤, 웹이 서버로 넘긴다) */
  static readonly CALLBACK_PATH = '/api/external-tools/oauth/callback';
  /** 한 차례에 갱신하는 로그인 수 (남은 것은 바로 다음 차례에) */
  private static readonly BATCH = 20;

  constructor(
    db: Database,
    private readonly box: SecretBox,
    private readonly gateway: OAuthGateway,
    private readonly gate: HostGate,
  ) {
    super(db);
  }

  /** 관리자의 "로그인": 로그인 서버를 찾고(처음이면 등록하고) 브라우저가 열 로그인 주소를 돌려준다 */
  async start(actor: Actor, req: VersionInput): Promise<OAuthStartView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const found = await new ExternalToolRepository(this.db.sql).login(spaceId, req.id, false);
    if (!found) throw new NotFound('외부 도구를 찾지 못했어요');
    found.assertVersion(req.version);
    found.assertOAuth();
    const server = await this.discover(found, await this.redirectUri());
    const { state, verifier } = OAuthGrant.begin(found.id);
    const pending = this.box.pack(
      OAuthGrant.purposeOf(found.id),
      OAuthGrant.pending(state, verifier),
      OAuthGrant.LOGIN_SECONDS,
    );
    await this.transaction(async (tx) => {
      const tools = new ExternalToolRepository(tx);
      const login = await tools.login(spaceId, req.id, true);
      if (!login) throw new NotFound('외부 도구를 찾지 못했어요');
      login.begin(found.url, server, pending);
      await tools.saveLogin(login);
    });
    return new OAuthStartView(OAuthGrant.authorizeUrl(server, state, verifier, found.url));
  }

  /**
   * 로그인 서버가 돌려보낸 곳 (관리자의 브라우저). 연결한 커넥터 id를 돌려준다.
   * 맞지 않는 state · 취소 · 토큰을 받지 못함은 OAuthStop으로 (화면으로 돌려보낸다). state는 맞으면 한 번 쓰고 지운다
   */
  async finish(actor: Actor, req: OAuthCallbackInput): Promise<string> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const toolId = OAuthGrant.toolOf(req.state);
    if (!toolId) throw new OAuthStop(OAuthStop.STATE, '로그인 확인값이 맞지 않아요');
    const now = new Date();
    const taken = await this.transaction(async (tx) => {
      const tools = new ExternalToolRepository(tx);
      const login = await tools.login(spaceId, toolId, true);
      if (!login) throw new OAuthStop(OAuthStop.STATE, '지운 커넥터예요');
      const found = login.take(this.box, req.state, now);
      await tools.saveLogin(login);
      return { url: login.url, ...found };
    });
    try {
      await this.connect(spaceId, toolId, req, taken, now);
    } catch (error) {
      if (error instanceof DomainError) await this.noteFailure(spaceId, toolId, error);
      throw error;
    }
    return toolId;
  }

  /** 맞는 state 뒤: 승인 코드를 토큰으로 바꿔(밖) 잠가 적는다(안) */
  private async connect(
    spaceId: string,
    toolId: string,
    req: OAuthCallbackInput,
    taken: { url: string; verifier: string; server: OAuthServer },
    now: Date,
  ): Promise<void> {
    const { url, verifier, server } = taken;
    if (req.code === null)
      throw new OAuthStop(OAuthStop.DENIED, '로그인 서버에서 로그인을 끝내지 않았어요');
    OAuthGrant.assertIssuer(server, req.iss);
    const form = OAuthGrant.codeForm(server, req.code, verifier, url);
    const answer = await this.gateway.postForm(new URL(server.token_endpoint), form);
    const tokens = OAuthGrant.tokens(answer, null, now);
    const sealed = this.box.seal(tokens.bundle);
    await this.transaction(async (tx) => {
      const tools = new ExternalToolRepository(tx);
      const login = await tools.login(spaceId, toolId, true);
      if (!login) throw new OAuthStop(OAuthStop.CHANGED, '로그인하는 사이 커넥터를 지웠어요');
      login.connect(url, sealed, tokens.expiresAt, tokens.refreshAt, new Date());
      await tools.saveLogin(login);
    });
  }

  /** 돌아온 뒤 실패한 까닭을 커넥터에 남긴다 (화면의 "로그인 실패"). 주소에는 짧은 까닭만 간다 */
  private async noteFailure(spaceId: string, toolId: string, error: DomainError): Promise<void> {
    await this.transaction(async (tx) => {
      const tools = new ExternalToolRepository(tx);
      const login = await tools.login(spaceId, toolId, true);
      if (!login) return;
      login.failed(error);
      await tools.saveLogin(login);
    });
  }

  /** 때가 된 로그인을 갱신한다 (ExternalToolRefreshJob). 다음에 다시 볼 때 (한 묶음을 꽉 채웠으면 지금) */
  async refreshDue(actor: Actor, now: Date): Promise<Date | null> {
    actor.assertOwnerOrSystem();
    const tools = new ExternalToolRepository(this.db.sql);
    const due = await tools.refreshDue(now, ExternalToolOAuthService.BATCH);
    for (const login of due) await this.refresh(login, now);
    return due.length === ExternalToolOAuthService.BATCH ? now : tools.nextRefresh();
  }

  /**
   * 로그인 하나를 갱신한다. 로그인 서버가 거절한 것(RuleViolation: invalid_grant · 갱신 토큰 없음 · 막힌 주소)은 "로그인 필요",
   * 답하지 못한 것(ExternalFailure)은 잠시 뒤 다시. 실패는 화면이 다시 읽게 알린다 (task.external_tool.noted)
   */
  private async refresh(before: ConnectorLogin, now: Date): Promise<void> {
    const renewed = await this.renew(before, now).catch((error: unknown) => {
      if (error instanceof DomainError) return error;
      throw error;
    });
    await this.transaction(async (tx) => {
      const tools = new ExternalToolRepository(tx);
      const login = await tools.login(before.spaceId, before.id, true);
      if (!login) return;
      const failed = renewed instanceof DomainError;
      const changed = failed
        ? login.refreshFailed(before, renewed, renewed instanceof RuleViolation, now)
        : login.refreshed(before, renewed.sealed, renewed.expiresAt, renewed.refreshAt);
      if (!changed) return;
      await tools.saveLogin(login);
      if (failed) await tools.announce(ExternalTool.noted(login.spaceId, { toolId: login.id }));
    });
  }

  /** 갱신 토큰으로 새 토큰을 받아 잠근다 (트랜잭션 밖). 새 갱신 토큰이 없으면 쓰던 것을 둔다 */
  private async renew(
    login: ConnectorLogin,
    now: Date,
  ): Promise<{ sealed: SealedSecret; expiresAt: Date | null; refreshAt: Date | null }> {
    const refresh = login.refreshToken(this.box);
    const server = login.server;
    if (refresh === null || server === null)
      throw new RuleViolation('갱신 토큰이 없어 다시 로그인해야 해요');
    const form = OAuthGrant.refreshForm(server, refresh, login.url);
    const answer = await this.gateway.postForm(new URL(server.token_endpoint), form);
    const tokens = OAuthGrant.tokens(answer, refresh, now);
    const { expiresAt, refreshAt } = tokens;
    return { sealed: this.box.seal(tokens.bundle), expiresAt, refreshAt };
  }

  /** ①~③ (OAuthMetadata): 보호된 자원 정보 → 로그인 서버 정보 → 등록이 없으면 동적 등록 */
  private async discover(login: ConnectorLogin, redirectUri: string): Promise<OAuthServer> {
    const resource = OAuthMetadata.resource(
      await this.gateway.firstJson(OAuthMetadata.resourceUrls(login.url)),
      login.url,
    );
    const meta = await this.gateway.firstJson(OAuthMetadata.serverUrls(resource.issuer));
    const server = OAuthMetadata.server(
      meta,
      resource.issuer,
      resource.scope,
      login.server,
      redirectUri,
    );
    if (server.client_id) return server;
    const answer = await this.gateway.postJson(
      OAuthMetadata.registrationUrl(server),
      OAuthMetadata.registration(server, redirectUri),
    );
    return OAuthMetadata.registered(server, answer, redirectUri);
  }

  /** 돌아올 주소: 사이트 주소(설정의 블로그 정보) 아래 CALLBACK_PATH */
  private async redirectUri(): Promise<string> {
    const origin = await this.gate.siteOrigin();
    if (!origin) throw new RuleViolation('사이트 주소부터 정해 주세요 (설정의 블로그 정보)');
    return `${origin}${ExternalToolOAuthService.CALLBACK_PATH}`;
  }
}
