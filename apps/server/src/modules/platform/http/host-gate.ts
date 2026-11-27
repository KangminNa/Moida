import { Injectable, Logger } from '@nestjs/common';
import { type Actor, SystemActor } from '../base/actor';
import { NotFound } from '../base/errors';

/** 앱 하나: [그 앱의 id, 앱이 든 공간의 id] */
type AppPlace = readonly [string, string];
/**
 * 앱 목록 읽기 (blog가 등록): domains = 모든 앱의 도메인(확인 전 것까지) → 앱, slugs = 모든 앱의 주소 → 앱
 * (공통 앱 도메인에서 x-cairn-app 머리글로 앱을 고른다, 2026-11-27)
 */
type AppHostsRead = (actor: Actor) => Promise<{
  domains: ReadonlyMap<string, AppPlace>;
  slugs: ReadonlyMap<string, AppPlace>;
}>;
/** 사이트 읽기 (account가 등록): [관리자가 정한 기본 도메인의 주소, 기본 도메인의 공간 id]. 정하기 전이면 null */
type SiteRead = (actor: Actor) => Promise<readonly [string | null, string | null]>;

/** HostGate가 보는 요청 (Express의 요청) */
type GateRequest = {
  method: string;
  path: string;
  headers: Record<string, unknown>;
  appHost?: string;
  appId?: string;
  appSpaceId?: string;
  appsDomain?: boolean;
  siteSpaceId?: string;
};
type GateResponse = { status(code: number): { json(body: object): void } };

/** 한 번 읽은 기본 도메인 · 앱 도메인 (READ_MS 동안 쓴다) */
class HostSnapshot {
  constructor(
    readonly siteOrigin: string | null,
    readonly siteHost: string | null,
    /** 기본 도메인의 공간 (스토어 가입, 2026-11-26) */
    readonly siteSpaceId: string | null,
    /** 앱 도메인 → [앱 id, 공간 id] */
    readonly apps: ReadonlyMap<string, AppPlace>,
    /** 앱 주소 → [앱 id, 공간 id] (공통 앱 도메인) */
    readonly slugs: ReadonlyMap<string, AppPlace>,
    readonly at: number,
  ) {}
}

// 앱마다 도메인 (스토어 3-0, docs/스토어.md 11장): 들어온 요청이 기본 도메인으로 왔는지, 앱 도메인으로 왔는지 가른다.
// platform은 무엇이 도메인을 갖는지 모른다: blog가 앱 도메인 목록과 그 도메인에서 열 경로를, account가 사이트 주소를 등록한다
// (Lookups와 같은 방식). 요청의 Host와 앞단 프록시가 넘긴 X-Forwarded-Host 가운데 하나라도 앱 도메인이면 앱 도메인 요청이다:
// - 등록한 경로만 지나고 나머지는 없는 주소와 같은 404 (콘솔 · 관리 API · MCP · OAuth는 기본 도메인에서만).
//   열 경로는 모듈이 등록한다 (openPaths): 읽기(GET · HEAD)만이거나, 쓰기까지 (커뮤니티의 회원 API, 스토어 3-1)
// - request.appHost · appId · appSpaceId에 그 도메인과 앱, 앱이 든 공간을 적는다 (커뮤니티의 이벤트 · 알림이 공간을 안다). ActorGuard는 관리자 쿠키 · 토큰을 보지 않는다 (회원은 커뮤니티가 따로 정한다)
// - 기본 도메인으로 온 요청에는 request.siteSpaceId에 기본 도메인의 공간을 적는다 (스토어 가입이 어느 스토어인지, 2026-11-26)
// 사이트 주소의 호스트는 앱 도메인으로 치지 않는다: 같은 값이 들어가도 콘솔이 막히지 않게 (blog도 그 값을 받지 않는다).
// 둘 다 머리글을 하나 더 속여 보내면 더 막힐 뿐 더 열리지 않는다. 도메인 목록은 30초 동안 기억하고, 바뀌면 stale로 바로 다시 읽는다.
// 공통 앱 도메인 (2026-11-27, 기획서 결정 "apps.moida.ai.kr"): 배포가 정한 CAIRN_APPS_URL의 호스트로 온 요청도 앱 도메인처럼
// 등록한 경로만 지난다. 여러 앱이 한 도메인을 쓰므로 앱은 웹이 경로의 첫 칸에서 읽어 x-cairn-app 머리글(앱 주소)로 알린다:
// 머리글을 속여도 같은 도메인의 다른 앱이 될 뿐이다 (그 앱들은 회원 쿠키 · 저장소를 이미 함께 쓴다). 머리글이 없으면 앱 없이
// (스토어 가입 · 공통 약관처럼 공간의 일) request.siteSpaceId만 적는다.
@Injectable()
export class HostGate {
  private static readonly READ_MS = 30_000;
  private static readonly READS = new Set(['GET', 'HEAD']);
  private readonly logger = new Logger('HostGate');
  private appHosts: AppHostsRead | null = null;
  private site: SiteRead | null = null;
  private readonly openReads: RegExp[] = [];
  private readonly openWrites: RegExp[] = [];
  private snapshot: HostSnapshot | null = null;
  private loading: Promise<HostSnapshot> | null = null;
  /** stale마다 하나씩 는다: 그 전에 시작한 읽기는 기억하지 않는다 */
  private generation = 0;

  /** blog가 시작할 때 한 번: 앱 도메인 목록 */
  registerApps(read: AppHostsRead): void {
    if (this.appHosts) throw new Error('앱 도메인은 한 번만 등록해요');
    this.appHosts = read;
  }

  /** 모듈이 시작할 때: 앱 도메인에서 열 경로. writes면 모든 메서드, 아니면 GET · HEAD만 */
  openPaths(paths: readonly RegExp[], writes = false): void {
    (writes ? this.openWrites : this.openReads).push(...paths);
  }

  /** account가 시작할 때 한 번: 사이트 주소와 공간 */
  registerSite(read: SiteRead): void {
    if (this.site) throw new Error('사이트 주소는 한 번만 등록해요');
    this.site = read;
  }

  /** 도메인이나 사이트 주소가 바뀌었다: 다음 요청에서 다시 읽는다 */
  stale(): void {
    this.generation += 1;
    this.snapshot = null;
    this.loading = null;
  }

  /** 기본 도메인의 출처 (https://example.com). 사이트 주소를 정하기 전이면 null */
  async siteOrigin(): Promise<string | null> {
    return (await this.read()).siteOrigin;
  }

  /** 기본 도메인의 호스트 (blog가 같은 도메인을 앱에 받지 않게) */
  async siteHost(): Promise<string | null> {
    return (await this.read()).siteHost;
  }

  /** 공통 앱 도메인의 호스트 (CAIRN_APPS_URL, 배포가 정한다). 없거나 틀린 주소면 null. 부를 때마다 읽는다 (테스트가 바꿔 본다) */
  appsHost(): string | null {
    const raw = process.env.CAIRN_APPS_URL ?? '';
    return URL.canParse(raw) ? HostGate.normalize(new URL(raw).host) : null;
  }

  /** 공통 앱 도메인의 출처 (https://apps.example.com). 없으면 null */
  appsOrigin(): string | null {
    const raw = process.env.CAIRN_APPS_URL ?? '';
    return URL.canParse(raw) ? new URL(raw).origin : null;
  }

  /** HttpSetup이 본문 읽기 전에 건다 */
  middleware(): (req: GateRequest, res: GateResponse, next: (error?: unknown) => void) => void {
    return (req, res, next) => {
      this.appOf(req.headers).then(async (found) => {
        if (found === null) {
          req.siteSpaceId = (await this.read()).siteSpaceId ?? undefined;
          return next();
        }
        [req.appHost, req.appId, req.appSpaceId] = found;
        if (found[1] === '' || this.isSharedHost(req.headers)) {
          req.appsDomain = true;
          req.siteSpaceId = (await this.read()).siteSpaceId ?? undefined;
          if (found[1] === '') [req.appId, req.appSpaceId] = [undefined, undefined];
        }
        if (this.isOpen(req.method, req.path)) return next();
        const missing = new NotFound('없는 주소예요');
        res.status(missing.status).json(missing.toJSON());
      }, next);
    };
  }

  private isOpen(method: string, path: string): boolean {
    if (this.openWrites.some((p) => p.test(path))) return true;
    return HostGate.READS.has(method.toUpperCase()) && this.openReads.some((p) => p.test(path));
  }

  /** 요청의 호스트들: Host와 X-Forwarded-Host */
  private static hostsOf(headers: Record<string, unknown>): string[] {
    return [headers.host, headers['x-forwarded-host']]
      .map((value) => HostGate.normalize(value))
      .filter((host): host is string => host !== null);
  }

  /** 공통 앱 도메인으로 온 요청인가 */
  private isSharedHost(headers: Record<string, unknown>): boolean {
    const shared = this.appsHost();
    return shared !== null && HostGate.hostsOf(headers).includes(shared);
  }

  /**
   * 요청이 앱 도메인으로 왔으면 [그 도메인, 앱 id, 공간 id]. Host와 X-Forwarded-Host를 모두 본다.
   * 공통 앱 도메인이면 x-cairn-app 머리글의 앱 (모르는 앱 · 머리글 없음이면 앱 id · 공간 id가 빈 글자)
   */
  private async appOf(headers: Record<string, unknown>): Promise<[string, string, string] | null> {
    const hosts = HostGate.hostsOf(headers);
    if (hosts.length === 0 || !this.appHosts) return null;
    const known = await this.read();
    const shared = this.appsHost();
    if (shared !== null && shared !== known.siteHost && hosts.includes(shared)) {
      const [appId, spaceId] = known.slugs.get(String(headers['x-cairn-app'] ?? '')) ?? ['', ''];
      return [shared, appId, spaceId];
    }
    const host = hosts.find((h) => h !== known.siteHost && known.apps.has(h));
    const [appId, spaceId] = host === undefined ? [] : (known.apps.get(host) ?? []);
    return host === undefined || !appId || !spaceId ? null : [host, appId, spaceId];
  }

  /** 머리글의 호스트: 첫 값, 소문자, 포트와 끝의 점을 뺀다. 비었으면 null */
  static normalize(value: unknown): string | null {
    const first = String(value ?? '')
      .split(',')[0]
      ?.trim()
      .toLowerCase();
    if (!first) return null;
    const host = first.startsWith('[') ? first.slice(0, first.indexOf(']') + 1) : first;
    return host.replace(/:\d*$/, '').replace(/\.$/, '') || null;
  }

  private async read(): Promise<HostSnapshot> {
    const now = Date.now();
    if (this.snapshot && now - this.snapshot.at < HostGate.READ_MS) return this.snapshot;
    if (this.loading) return this.loading;
    const loading = this.load(now, this.generation).finally(() => {
      if (this.loading === loading) this.loading = null;
    });
    this.loading = loading;
    return loading;
  }

  /** 다시 읽는다. 읽지 못하면 앞에 읽은 것을 그대로 쓴다 (처음이면 오류) */
  private async load(now: number, generation: number): Promise<HostSnapshot> {
    const actor = new SystemActor();
    try {
      const [[siteUrl, siteSpaceId], apps] = await Promise.all([
        this.site ? this.site(actor) : ([null, null] as const),
        this.appHosts ? this.appHosts(actor) : { domains: new Map(), slugs: new Map() },
      ]);
      const site = siteUrl ? new URL(siteUrl) : null;
      const read = new HostSnapshot(
        site?.origin ?? null,
        site ? HostGate.normalize(site.host) : null,
        siteSpaceId,
        apps.domains,
        apps.slugs,
        now,
      );
      if (generation === this.generation) this.snapshot = read;
      return read;
    } catch (error) {
      if (!this.snapshot) throw error;
      this.logger.error(`도메인 목록을 다시 읽지 못했어요: ${String(error)}`);
      return this.snapshot;
    }
  }
}
