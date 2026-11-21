import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { BaseGateway, ExternalFailure, RuleViolation } from '../../platform';
import { PublicAddress } from '../web/public-address.policy';

/** 로그인 서버의 답 한 번: 상태 코드 · JSON 본문(JSON이 아니면 null) · 넘어갈 주소 */
class OAuthAnswer {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly location: string | null,
  ) {}
}

// OAuth 커넥터(C1)가 로그인 서버를 부르는 길 하나: 보호된 자원 정보 · 로그인 서버 정보 · 동적 등록 · 토큰 받기 · 갱신.
// 서버가 바깥에 붙는 길이라 내부망을 들여다보는 길이 되지 않게 read_url(WebPageGateway)과 같은 규칙으로 막는다:
// https만, 이름을 풀어 나온 주소가 하나라도 내부 · 이 서버 · 메타데이터 주소면 붙지 않고(PublicAddress), 확인한 그 주소로만 붙는다.
// 리다이렉트는 GET만 MAX_HOPS번까지 따라가고 매번 다시 확인한다 (https가 아니면 멈춘다). POST(등록 · 토큰)는 따라가지 않는다.
// 한도: 시간 timeoutMs, 답 MAX_BYTES. 본문 · 토큰 · 폼은 로그와 오류 글에 싣지 않는다.
// 시험에서만(TEST_LOOPBACK_ENV=1) 127.0.0.1 · [::1]를 그대로 적은 주소의 가짜 서버를 열고, 그 주소는 https 대신 http로 말한다
export class OAuthGateway extends BaseGateway {
  /** 시험에서만 켠다 (운영에서 켜지 않는다) */
  static readonly TEST_LOOPBACK_ENV = 'CAIRN_OAUTH_TEST_LOOPBACK';
  static readonly MAX_BYTES = 256 * 1024;
  static readonly MAX_HOPS = 3;
  protected readonly name = 'OAuth 로그인 서버';
  protected override readonly timeoutMs = 10_000;
  private static readonly AGENT = 'Cairn/1.0 (MCP OAuth client)';

  /** 주소들을 차례로 GET해 처음으로 200과 JSON을 준 곳의 본문. 모두 없으면(404 등) null */
  async firstJson(urls: readonly URL[]): Promise<unknown> {
    for (const url of urls) {
      const answer = await this.get(url);
      if (answer.status === 200 && answer.body !== null) return answer.body;
    }
    return null;
  }

  /** JSON 본문을 POST (동적 등록) */
  postJson(url: URL, body: object): Promise<OAuthAnswer> {
    return this.send(url, 'POST', 'application/json', JSON.stringify(body));
  }

  /** 폼을 POST (토큰 받기 · 갱신) */
  postForm(url: URL, form: URLSearchParams): Promise<OAuthAnswer> {
    return this.send(url, 'POST', 'application/x-www-form-urlencoded', form.toString());
  }

  private async get(start: URL): Promise<OAuthAnswer> {
    let url = start;
    for (let hop = 0; hop <= OAuthGateway.MAX_HOPS; hop++) {
      const answer = await this.send(url, 'GET', null, null);
      if (answer.status < 300 || answer.status >= 400 || !answer.location) return answer;
      url = new URL(answer.location, url);
    }
    throw new ExternalFailure(
      `다른 주소로 ${OAuthGateway.MAX_HOPS}번 넘게 넘어가요 (${start.host})`,
    );
  }

  private async send(
    url: URL,
    method: string,
    type: string | null,
    body: string | null,
  ): Promise<OAuthAnswer> {
    const plain = this.plainHttp(url);
    const address = await this.resolve(url.hostname);
    return this.call((signal) => this.exchange(url, plain, address, method, type, body, signal));
  }

  /** https만 연다. 시험 스위치가 켜졌고 루프백 주소를 그대로 적었으면 http로 말한다 (true) */
  private plainHttp(url: URL): boolean {
    const loopback = OAuthGateway.loopback() && PublicAddress.isLoopback(url.hostname);
    if (url.username || url.password) throw new RuleViolation('계정을 넣은 주소는 열지 않아요');
    if (url.protocol === 'https:') return loopback;
    if (url.protocol === 'http:' && loopback) return true;
    throw new RuleViolation(`https 주소만 열어요 (${url.host})`);
  }

  /** 이름을 풀어 쓸 주소 하나. 나온 주소 중 하나라도 막힌 곳이면 붙지 않는다 */
  private async resolve(hostname: string): Promise<LookupAddress> {
    const host = hostname.replace(/^\[|\]$/g, '');
    const family = isIP(host);
    const found: LookupAddress[] = family
      ? [{ address: host, family }]
      : await lookup(host, { all: true, verbatim: true }).catch(() => {
          throw new ExternalFailure(`주소를 찾지 못했어요 (${host})`);
        });
    for (const a of found)
      if (PublicAddress.blocked(a.address, OAuthGateway.loopback()))
        throw new RuleViolation('내부망 · 이 서버의 주소에는 붙지 않아요');
    const [first] = found;
    if (!first) throw new ExternalFailure(`주소를 찾지 못했어요 (${host})`);
    return first;
  }

  private exchange(
    url: URL,
    plain: boolean,
    address: LookupAddress,
    method: string,
    type: string | null,
    body: string | null,
    signal: AbortSignal,
  ): Promise<OAuthAnswer> {
    const target = new URL(url);
    if (plain) target.protocol = 'http:';
    const send = plain ? httpRequest : httpsRequest;
    const length = body === null ? {} : { 'content-length': String(Buffer.byteLength(body)) };
    return new Promise((resolve, reject) => {
      const req = send(
        target,
        {
          method,
          signal,
          headers: {
            'user-agent': OAuthGateway.AGENT,
            accept: 'application/json',
            ...(type ? { 'content-type': type } : {}),
            ...length,
          },
          // 확인한 주소로만 붙는다. 인증서는 원래 이름으로 확인한다 (url의 호스트를 그대로 둔다)
          lookup: (_name, options, done) => {
            if ((options as { all?: boolean }).all) done(null, [address]);
            else done(null, address.address, address.family);
          },
        },
        (res) => void OAuthGateway.read(res).then(resolve, reject),
      );
      req.on('error', reject);
      req.end(body ?? undefined);
    });
  }

  /** 답을 MAX_BYTES까지 읽는다. JSON이 아니면 본문은 null */
  private static async read(res: IncomingMessage): Promise<OAuthAnswer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > OAuthGateway.MAX_BYTES) {
        res.destroy();
        throw new ExternalFailure('답이 너무 커요');
      }
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const location = res.headers.location;
    return new OAuthAnswer(res.statusCode ?? 0, body, location ?? null);
  }

  private static loopback(): boolean {
    return process.env[OAuthGateway.TEST_LOOPBACK_ENV] === '1';
  }
}
