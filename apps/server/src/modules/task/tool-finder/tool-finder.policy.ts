import { RuleViolation } from '../../platform';

type Raw = Record<string, unknown>;

/** 찾은 서버 하나 (find_tool의 답 한 줄) */
export class FoundTool {
  constructor(
    readonly name: string,
    readonly title: string,
    readonly description: string,
    /** 원격 MCP 주소 (https). 없으면 로컬 실행용만 있다 */
    readonly url: string | null,
    readonly transport: string | null,
    /** 게시자: 확인된 도메인(com.example → example.com) · GitHub 계정 */
    readonly publisher: string,
    /** 공식: 게시자 도메인과 원격 주소가 모두 서비스 도메인 아래 */
    readonly official: boolean,
    /** 원격 주소에 실어야 하는 머리글 (키가 필요하다) */
    readonly headers: readonly string[],
    readonly why: string,
  ) {}
}

// 도구 찾기의 판단 (2026-11-24, find_tool): 공식 MCP 레지스트리의 답(믿지 않는 자료)에서 칸을 골라 후보로 만든다.
// 레지스트리는 이름공간을 확인한다: com.example 같은 도메인 이름공간은 DNS · HTTP로, io.github.<계정>은 GitHub 로그인으로.
// 그래서 "공식"은 일꾼이 준 서비스 도메인과 게시자 도메인이 같고(또는 그 아래), 원격 주소도 그 도메인 아래일 때만이다.
// 원격(streamable-http · sse, https) 주소가 없는 서버는 로컬 실행용이라 바로 붙이지 않는다 (남의 코드를 서버에서 돌리지 않는다)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class ToolFinder {
  static readonly SHOWN = 10;
  private static readonly DOMAIN = /^(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
  private static readonly TRANSPORTS = ['streamable-http', 'sse'];

  /** 일꾼이 준 서비스 도메인 (예: higgsfield.ai). 주소를 주면 호스트만, www.는 뗀다 */
  static domainOf(raw: string | null): string | null {
    if (raw === null || raw.trim() === '') return null;
    const host =
      raw
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split(/[/?#:]/)[0] ?? '';
    const domain = host.replace(/^www\./, '');
    if (!ToolFinder.DOMAIN.test(domain))
      throw new RuleViolation('domain: 서비스의 도메인을 적어요 (예: example.com)');
    return domain;
  }

  /** 레지스트리의 답 → 후보 (공식 → 원격 → 나머지 차례, SHOWN개까지) */
  static candidates(body: unknown, domain: string | null): FoundTool[] {
    const items = Array.isArray((body as Raw | null)?.servers)
      ? ((body as Raw).servers as unknown[])
      : [];
    const found = items.flatMap((item) => {
      const server = ((item as Raw | null)?.server ?? item) as Raw | null;
      return server && typeof server.name === 'string' ? [ToolFinder.one(server, domain)] : [];
    });
    const rank = (t: FoundTool) => (t.official ? 0 : t.url ? 1 : 2);
    return found.sort((a, b) => rank(a) - rank(b)).slice(0, ToolFinder.SHOWN);
  }

  private static one(server: Raw, domain: string | null): FoundTool {
    const name = String(server.name).slice(0, 200);
    const publisher = ToolFinder.publisherOf(name);
    const remotes = (Array.isArray(server.remotes) ? server.remotes : []) as Raw[];
    const remote = remotes.find(
      (r) =>
        ToolFinder.TRANSPORTS.includes(String(r.type)) && /^https:\/\//.test(String(r.url ?? '')),
    );
    const url = remote ? String(remote.url).slice(0, 500) : null;
    const host = url ? new URL(url).hostname : null;
    const under = (d: string | null) =>
      d !== null && domain !== null && (d === domain || d.endsWith(`.${domain}`));
    const official =
      url !== null && publisher.domain !== null && under(publisher.domain) && under(host);
    const headers = ((remote?.headers ?? []) as Raw[])
      .filter((h) => h.isRequired === true || h.isSecret === true)
      .map((h) => String(h.name ?? '').slice(0, 40))
      .filter((h) => h !== '');
    return new FoundTool(
      name,
      String(server.title ?? name).slice(0, 100),
      String(server.description ?? '').slice(0, 300),
      url,
      remote ? String(remote.type) : null,
      publisher.label,
      official,
      headers,
      ToolFinder.why(url, official, publisher, host, domain),
    );
  }

  private static why(
    url: string | null,
    official: boolean,
    publisher: { label: string; domain: string | null },
    host: string | null,
    domain: string | null,
  ): string {
    if (!url)
      return '원격 주소가 없는 로컬 실행용이라 바로 붙이지 않아요 (API 문서로 API 커넥터를 만드세요)';
    if (official) return `공식: 게시자 도메인과 원격 주소가 모두 ${domain} 아래예요`;
    if (domain === null)
      return `서비스 도메인을 주지 않아 공식인지 보지 않았어요 (게시자 ${publisher.label}, 주소 ${host})`;
    return `제3자: 게시자 ${publisher.label}, 주소 ${host}가 ${domain}의 것이 아니에요. 관리자에게 그렇게 알리고 제안하세요`;
  }

  /** 이름공간 → 게시자. io.github.<계정>은 GitHub 계정, 나머지는 거꾸로 적은 도메인 */
  private static publisherOf(name: string): { label: string; domain: string | null } {
    const space = name.split('/')[0] ?? '';
    const github = /^io\.github\.([A-Za-z0-9-]+)$/.exec(space);
    if (github) return { label: `GitHub ${github[1]}`, domain: null };
    const domain = space.split('.').reverse().join('.').toLowerCase();
    return ToolFinder.DOMAIN.test(domain)
      ? { label: domain, domain }
      : { label: space, domain: null };
  }
}
