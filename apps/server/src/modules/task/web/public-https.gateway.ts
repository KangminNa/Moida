import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { BaseGateway, ExternalFailure, RuleViolation } from '../../platform';
import { PublicAddress } from './public-address.policy';

/** 붙을 곳 하나: 확인한 주소와, 시험의 루프백이라 http로 말하는지 */
class PinnedTarget {
  constructor(
    readonly url: URL,
    readonly plain: boolean,
    readonly address: LookupAddress,
  ) {}
}

// 서버가 바깥 https에 붙는 길의 기반 (OAuth 커넥터의 OAuthGateway · API 커넥터의 ApiCallGateway · 도구 찾기의 ToolRegistryGateway).
// read_url(WebPageGateway)과 같은 규칙: https만, 계정을 넣은 주소는 열지 않고, 이름을 풀어 나온 주소가 하나라도
// 내부 · 이 서버 · 메타데이터 주소면 붙지 않으며(PublicAddress), 확인한 그 주소로만 붙는다 (이름을 다시 풀지 않는다).
// 인증서는 원래 이름으로 확인한다. 시험에서만(TEST_LOOPBACK_ENV=1) 127.0.0.1 · [::1]를 그대로 적은 주소를 http로 연다
export abstract class PublicHttpsGateway extends BaseGateway {
  /** 시험에서만 켠다 (운영에서 켜지 않는다) */
  static readonly TEST_LOOPBACK_ENV = 'CAIRN_OAUTH_TEST_LOOPBACK';
  protected abstract readonly agent: string;

  /** 붙을 곳을 정한다: https인지 보고 이름을 풀어 막을 주소가 아닌지 확인한다 */
  protected async pin(url: URL): Promise<PinnedTarget> {
    const plain = PublicHttpsGateway.plainHttp(url);
    return new PinnedTarget(url, plain, await PublicHttpsGateway.resolve(url.hostname));
  }

  /** 확인한 주소로 요청 하나를 보낸다. 답의 본문은 부르는 쪽이 읽는다 */
  protected open(
    target: PinnedTarget,
    method: string,
    headers: Readonly<Record<string, string>>,
    body: string | null,
    signal: AbortSignal,
  ): Promise<IncomingMessage> {
    const url = new URL(target.url);
    if (target.plain) url.protocol = 'http:';
    const send = target.plain ? httpRequest : httpsRequest;
    const length = body === null ? {} : { 'content-length': String(Buffer.byteLength(body)) };
    const { address } = target;
    return new Promise((resolve, reject) => {
      const req = send(
        url,
        {
          method,
          signal,
          headers: { 'user-agent': this.agent, ...headers, ...length },
          lookup: (_name, options, done) => {
            if ((options as { all?: boolean }).all) done(null, [address]);
            else done(null, address.address, address.family);
          },
        },
        resolve,
      );
      req.on('error', reject);
      req.end(body ?? undefined);
    });
  }

  /** 답을 max바이트까지 읽는다. 넘으면 끊고 실패 */
  protected static async readAll(res: IncomingMessage, max: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > max) {
        res.destroy();
        throw new ExternalFailure('답이 너무 커요');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /** 글을 JSON으로 읽는다. JSON이 아니면 null */
  protected static json(text: string): unknown {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  protected static loopback(): boolean {
    return process.env[PublicHttpsGateway.TEST_LOOPBACK_ENV] === '1';
  }

  /** https만 연다. 시험 스위치가 켜졌고 루프백 주소를 그대로 적었으면 http로 말한다 (true) */
  private static plainHttp(url: URL): boolean {
    const loopback = PublicHttpsGateway.loopback() && PublicAddress.isLoopback(url.hostname);
    if (url.username || url.password) throw new RuleViolation('계정을 넣은 주소는 열지 않아요');
    if (url.protocol === 'https:') return loopback;
    if (url.protocol === 'http:' && loopback) return true;
    throw new RuleViolation(`https 주소만 열어요 (${url.host})`);
  }

  /** 이름을 풀어 쓸 주소 하나. 나온 주소 중 하나라도 막힌 곳이면 붙지 않는다 */
  private static async resolve(hostname: string): Promise<LookupAddress> {
    const host = hostname.replace(/^\[|\]$/g, '');
    const family = isIP(host);
    const found: LookupAddress[] = family
      ? [{ address: host, family }]
      : await lookup(host, { all: true, verbatim: true }).catch(() => {
          throw new ExternalFailure(`주소를 찾지 못했어요 (${host})`);
        });
    for (const a of found)
      if (PublicAddress.blocked(a.address, PublicHttpsGateway.loopback()))
        throw new RuleViolation('내부망 · 이 서버의 주소에는 붙지 않아요');
    const [first] = found;
    if (!first) throw new ExternalFailure(`주소를 찾지 못했어요 (${host})`);
    return first;
  }
}
