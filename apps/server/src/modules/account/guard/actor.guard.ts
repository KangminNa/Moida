import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import {
  AgentActor,
  Cookies,
  Forbidden,
  type HttpRequest,
  SecretBox,
  SystemActor,
} from '../../platform';
import { DeviceQuery } from '../device/device.query';
import { DeviceService } from '../device/device.service';
import { WebSession } from '../owner/owner';
import { OwnerQuery } from '../owner/owner.query';
import { OwnerService } from '../owner/owner.service';
import { SpaceQuery } from '../space/space.query';

// 모든 요청에서 요청자를 정한다: 작업 토큰 → 에이전트, 그 밖의 Bearer 토큰 → 기기 (둘 다 /mcp에서만),
// 로그인 쿠키 → 주인, 없으면 방문자. 앱 도메인으로 온 요청(HostGate의 appHost, 스토어 3-0)은 늘 방문자다:
// 앱 도메인에는 관리 API가 없고, 그 도메인의 쿠키 · 토큰으로 관리자가 되는 길을 두지 않는다.
// AI의 입구는 /mcp 하나다: Bearer 토큰은 REST(/api)에서 요청자가 되지 않아 방문자와 같다.
// REST의 관리 일에 권한 확인이 하나 빠져도 AI 토큰은 닿지 않게 구조로 막는다 (2026-11-06).
// 누구인지 정하는 것 말고 막는 일은 하나뿐이다: 로그인 쿠키로 오는 쓰기 요청의 출처 확인.
// 그 밖의 권한은 Service 첫 줄에서 확인한다 (/mcp는 기기나 살아 있는 작업이 아니면 401).
// 알아본 로그인 · 기기는 마지막 접근을 남긴다 (보안 화면, Service가 5분에 한 번만 적는다).
// 마지막 접근을 적지 못해도 요청은 막지 않는다 (서버 로그에 남긴다).
@Injectable()
export class ActorGuard implements CanActivate {
  private static readonly READS = new Set(['GET', 'HEAD', 'OPTIONS']);
  private static readonly MCP = '/mcp';
  private readonly logger = new Logger('마지막 접근');

  constructor(
    private readonly owners: OwnerQuery,
    private readonly devices: DeviceQuery,
    private readonly ownerSessions: OwnerService,
    private readonly deviceAccess: DeviceService,
    private readonly spaces: SpaceQuery,
    private readonly box: SecretBox,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest & { path: string }>();
    if (request.appHost !== undefined) return true;
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(request.headers.authorization ?? ''))?.[1];
    if (bearer) {
      // AI 토큰은 MCP 입구에서만 쓴다. 작업 토큰은 호출마다 작업을 확인하는 곳이 거기뿐이고,
      // 기기 토큰이 REST에서 write 권한으로 통하면 기기 권한 바꾸기처럼 주인의 일까지 닿는다
      if (request.path !== ActorGuard.MCP) return true;
      if (AgentActor.isToken(bearer)) {
        request.actor = AgentActor.open(this.box, bearer) ?? undefined;
        return true;
      }
      const device = await this.devices.actorFor(bearer);
      request.actor = device ?? undefined;
      if (device?.id)
        await this.note(this.deviceAccess.seen(device.id, request.ip ?? '', new Date()));
      return true;
    }
    const token = Cookies.read(request, WebSession.COOKIE);
    if (!token) return true;
    if (!ActorGuard.READS.has(request.method.toUpperCase())) await this.assertSameSite(request);
    const owner = await this.owners.actorFor(token);
    request.actor = owner ?? undefined;
    if (owner) await this.note(this.ownerSessions.seen(token, request.ip ?? '', new Date()));
    return true;
  }

  /** 마지막 접근 적기를 기다린다. 실패해도 요청은 그대로 */
  private async note(work: Promise<void>): Promise<void> {
    await work.catch((error: unknown) =>
      this.logger.error(`마지막 접근을 적지 못했어요: ${String(error)}`),
    );
  }

  /**
   * 다른 사이트가 주인의 로그인 쿠키로 몰래 보내는 쓰기 요청을 막는다.
   *   Sec-Fetch-Site가 cross-site면 막는다 (요즘 브라우저는 늘 붙인다).
   *   Origin이 있으면 사이트 주소(정하기 전이면 이 요청이 온 주소)와 같아야 한다.
   *   다만 Sec-Fetch-Site가 same-origin이고 Origin이 이 요청이 온 주소면 통과한다 (새 주소로 옮기는 중인 콘솔).
   *   Origin이 없으면 브라우저가 보낸 요청이 아니다 (브라우저는 다른 출처로 쓰기를 보낼 때 늘 Origin을 붙인다).
   */
  private async assertSameSite(request: HttpRequest): Promise<void> {
    const fetchSite = String(request.headers['sec-fetch-site'] ?? '');
    const origin = request.headers.origin;
    if (fetchSite !== 'cross-site' && typeof origin !== 'string') return;
    const { siteUrl } = await this.spaces.info(new SystemActor());
    const self = ActorGuard.selfOrigins(request);
    // 브라우저가 같은 출처라고 밝힌 요청(이 주소에서 연 화면이 이 주소로 보냄)은 사이트 주소와 달라도 된다 (2026-11-26):
    // 사이트 주소를 새 도메인으로 옮길 때 새 주소에서 연 콘솔이 사이트 주소조차 바꾸지 못하던 막힘을 푼다.
    // 다른 사이트는 same-origin을 만들 수 없고, 앱 화면은 격리(출처 없음)되거나 앱 도메인(위에서 방문자)이라 여기 오지 않는다
    if (fetchSite === 'same-origin' && typeof origin === 'string' && self.includes(origin)) return;
    const expected = siteUrl ? [new URL(siteUrl).origin] : self;
    if (fetchSite !== 'cross-site' && typeof origin === 'string' && expected.includes(origin))
      return;
    throw new Forbidden(
      'origin',
      siteUrl
        ? `사이트 주소(${siteUrl})로 연 화면에서만 바꿀 수 있어요`
        : '이 블로그에서 연 화면에서만 바꿀 수 있어요',
    );
  }

  /**
   * 사이트 주소를 정하기 전(설치 중)에 쓰는 "이 요청이 온 주소". 앞의 프록시(웹 서버 포함)가 넘긴 원래 주소도 본다.
   * 다른 사이트의 화면은 이 머리글들을 붙여 보낼 수 없다 (브라우저가 미리 묻기(preflight)에서 막는다).
   */
  private static selfOrigins(request: HttpRequest): string[] {
    const first = (value: unknown) =>
      String(value ?? '')
        .split(',')[0]
        ?.trim() ?? '';
    const proto = first(request.headers['x-forwarded-proto']) || request.protocol;
    return [first(request.headers['x-forwarded-host']), first(request.headers.host)]
      .filter(Boolean)
      .map((host) => `${proto}://${host}`);
  }
}
