import { Injectable, Logger } from '@nestjs/common';
import { type Actor, SystemActor } from '../base/actor';
import { NotFound } from '../base/errors';

/** 앱 도메인 목록 읽기 (blog가 등록): 모든 앱의 도메인, 확인 전 것까지 */
type AppHostsRead = (actor: Actor) => Promise<readonly string[]>;
/** 사이트 주소 읽기 (account가 등록): 관리자가 정한 기본 도메인의 주소. 정하기 전이면 null */
type SiteRead = (actor: Actor) => Promise<string | null>;

/** HostGate가 보는 요청 (Express의 요청) */
type GateRequest = {
  method: string;
  path: string;
  headers: Record<string, unknown>;
  appHost?: string;
};
type GateResponse = { status(code: number): { json(body: object): void } };

/** 한 번 읽은 기본 도메인 · 앱 도메인 (READ_MS 동안 쓴다) */
class HostSnapshot {
  constructor(
    readonly siteOrigin: string | null,
    readonly siteHost: string | null,
    readonly apps: ReadonlySet<string>,
    readonly at: number,
  ) {}
}

// 앱마다 도메인 (스토어 3-0, docs/스토어.md 11장): 들어온 요청이 기본 도메인으로 왔는지, 앱 도메인으로 왔는지 가른다.
// platform은 무엇이 도메인을 갖는지 모른다: blog가 앱 도메인 목록과 그 도메인에서 열 경로를, account가 사이트 주소를 등록한다
// (Lookups와 같은 방식). 요청의 Host와 앞단 프록시가 넘긴 X-Forwarded-Host 가운데 하나라도 앱 도메인이면 앱 도메인 요청이다:
// - 등록한 경로(GET · HEAD)만 지나고 나머지는 없는 주소와 같은 404 (콘솔 · 관리 API · MCP · OAuth는 기본 도메인에서만)
// - request.appHost에 그 도메인을 적는다. 요청자는 늘 방문자다 (ActorGuard가 쿠키 · 토큰을 보지 않는다)
// 사이트 주소의 호스트는 앱 도메인으로 치지 않는다: 같은 값이 들어가도 콘솔이 막히지 않게 (blog도 그 값을 받지 않는다).
// 둘 다 머리글을 하나 더 속여 보내면 더 막힐 뿐 더 열리지 않는다. 도메인 목록은 30초 동안 기억하고, 바뀌면 stale로 바로 다시 읽는다.
@Injectable()
export class HostGate {
  private static readonly READ_MS = 30_000;
  private static readonly READS = new Set(['GET', 'HEAD']);
  private readonly logger = new Logger('HostGate');
  private appHosts: AppHostsRead | null = null;
  private site: SiteRead | null = null;
  private readonly open: RegExp[] = [];
  private snapshot: HostSnapshot | null = null;
  private loading: Promise<HostSnapshot> | null = null;
  /** stale마다 하나씩 는다: 그 전에 시작한 읽기는 기억하지 않는다 */
  private generation = 0;

  /** blog가 시작할 때 한 번: 앱 도메인 목록과, 앱 도메인에서 열 경로 (GET · HEAD) */
  registerApps(read: AppHostsRead, open: readonly RegExp[]): void {
    if (this.appHosts) throw new Error('앱 도메인은 한 번만 등록해요');
    this.appHosts = read;
    this.open.push(...open);
  }

  /** account가 시작할 때 한 번: 사이트 주소 */
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

  /** HttpSetup이 본문 읽기 전에 건다 */
  middleware(): (req: GateRequest, res: GateResponse, next: (error?: unknown) => void) => void {
    return (req, res, next) => {
      this.appHostOf(req.headers).then((host) => {
        if (host === null) return next();
        req.appHost = host;
        if (HostGate.READS.has(req.method.toUpperCase()) && this.open.some((p) => p.test(req.path)))
          return next();
        const missing = new NotFound('없는 주소예요');
        res.status(missing.status).json(missing.toJSON());
      }, next);
    };
  }

  /** 요청이 앱 도메인으로 왔으면 그 도메인. Host와 X-Forwarded-Host를 모두 본다 */
  private async appHostOf(headers: Record<string, unknown>): Promise<string | null> {
    const hosts = [headers.host, headers['x-forwarded-host']]
      .map((value) => HostGate.normalize(value))
      .filter((host): host is string => host !== null);
    if (hosts.length === 0 || !this.appHosts) return null;
    const known = await this.read();
    return hosts.find((host) => host !== known.siteHost && known.apps.has(host)) ?? null;
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
      const [siteUrl, apps] = await Promise.all([
        this.site ? this.site(actor) : null,
        this.appHosts ? this.appHosts(actor) : [],
      ]);
      const site = siteUrl ? new URL(siteUrl) : null;
      const read = new HostSnapshot(
        site?.origin ?? null,
        site ? HostGate.normalize(site.host) : null,
        new Set(apps),
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
