import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { BaseGateway, ExternalFailure, FileSniff, RuleViolation } from '../../platform';
import { HtmlText } from './html-text';
import { PublicAddress } from './public-address.policy';

/** 받아 온 페이지 한 장 (글자만). 미리보기 칸(사이트 이름 · 설명 · 대표 그림 주소)은 HTML의 메타 태그에서 (없으면 빈 글자 · null) */
export class WebPage {
  constructor(
    readonly url: string,
    readonly title: string,
    readonly text: string,
    readonly truncated: boolean,
    readonly contentType: string,
    readonly site: string = '',
    readonly description: string = '',
    readonly image: string | null = null,
  ) {}
}

/** 받아 온 그림 한 장 (링크 미리보기의 대표 그림). 형식은 앞부분으로 알아본 것 */
export class WebImage {
  constructor(
    readonly bytes: Buffer,
    readonly mime: string,
  ) {}
}

// 서버가 AI 대신 주소 하나를 열어 글자만 돌려준다 (read_url).
// 서버가 대신 여는 것이라 내부망을 들여다보는 길이 되지 않게: 이름을 풀어 나온 주소가 하나라도 내부 · 이 서버면 열지 않고,
// 확인한 그 주소로만 붙는다 (확인한 뒤 이름이 다른 주소로 바뀌어도 따라가지 않게). 리다이렉트는 MAX_HOPS번까지, 매번 다시 확인한다.
// 한도: 받기 MAX_BYTES (넘으면 앞부분만), AI에게 주는 글자 TEXT_MAX, 시간 timeoutMs. 글자가 아닌 형식(PDF · 그림)은 열지 않는다.
export class WebPageGateway extends BaseGateway {
  /** 시험에서만: 127.0.0.1 · ::1의 가짜 사이트를 열게 한다 (운영에서 켜지 않는다) */
  static readonly TEST_LOOPBACK_ENV = 'CAIRN_READ_URL_TEST_LOOPBACK';
  static readonly MAX_HOPS = 3;
  static readonly MAX_BYTES = 2 * 1024 * 1024;
  static readonly TEXT_MAX = 60_000;
  /** 링크 미리보기의 대표 그림 한도 */
  static readonly IMAGE_MAX = 1024 * 1024;
  private static readonly IMAGES: readonly string[] = [
    FileSniff.PNG,
    FileSniff.JPEG,
    FileSniff.GIF,
    FileSniff.WEBP,
  ];
  protected readonly name = '웹 페이지';
  protected override readonly timeoutMs = 15_000;
  private static readonly TEXT_TYPES =
    /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json|rss\+xml|atom\+xml)\b)/i;
  private static readonly HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/i;
  private static readonly AGENT = 'Mozilla/5.0 (compatible; CairnReader/1.0; +read_url)';

  /** 주소 하나를 연다. allow는 주소마다(리다이렉트 포함) 목줄을 묻는다 (안 되면 던진다) */
  async read(start: URL, allow: (url: URL) => void): Promise<WebPage> {
    const [url, res] = await this.open(start, allow);
    return this.page(url, res);
  }

  /** 그림 하나 (링크 미리보기). PNG · JPEG · GIF · WebP를 앞부분으로 알아본 것만, IMAGE_MAX까지. 길은 read와 같다 */
  async image(start: URL, allow: (url: URL) => void): Promise<WebImage> {
    const [, res] = await this.open(start, allow);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      size += chunk.length;
      if (size > WebPageGateway.IMAGE_MAX) {
        res.destroy();
        throw new RuleViolation('그림이 너무 커요');
      }
    }
    const bytes = Buffer.concat(chunks);
    const mime = FileSniff.mimeOf(bytes);
    if (mime === null || !WebPageGateway.IMAGES.includes(mime))
      throw new RuleViolation('PNG · JPEG · GIF · WebP 그림이 아니에요');
    return new WebImage(bytes, mime);
  }

  /** 리다이렉트를 따라가며 연다 (매번 목줄 · 내부망을 다시 본다). 2xx의 응답과 마지막 주소 */
  private async open(start: URL, allow: (url: URL) => void): Promise<[URL, IncomingMessage]> {
    let url = start;
    for (let hop = 0; hop <= WebPageGateway.MAX_HOPS; hop++) {
      allow(url);
      const address = await this.resolve(url.hostname);
      const res = await this.call((signal) => this.get(url, address, signal));
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        url = new URL(location, url);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new ExternalFailure(`열지 못했어요 (HTTP ${status})`);
      }
      return [url, res];
    }
    throw new RuleViolation(`다른 주소로 ${WebPageGateway.MAX_HOPS}번 넘게 넘어가요`);
  }

  /** 이름을 풀어 쓸 주소 하나. 나온 주소 중 하나라도 막힌 곳이면 열지 않는다 */
  private async resolve(hostname: string): Promise<LookupAddress> {
    const host = hostname.replace(/^\[|\]$/g, '');
    const family = isIP(host);
    const found: LookupAddress[] = family
      ? [{ address: host, family }]
      : await lookup(host, { all: true, verbatim: true }).catch(() => {
          throw new ExternalFailure(`주소를 찾지 못했어요 (${host})`);
        });
    for (const a of found)
      if (PublicAddress.blocked(a.address, process.env[WebPageGateway.TEST_LOOPBACK_ENV] === '1'))
        throw new RuleViolation('내부망 · 이 서버의 주소는 열 수 없어요');
    const [first] = found;
    if (!first) throw new ExternalFailure(`주소를 찾지 못했어요 (${host})`);
    return first;
  }

  private get(url: URL, address: LookupAddress, signal: AbortSignal): Promise<IncomingMessage> {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(
        url,
        {
          method: 'GET',
          signal,
          headers: {
            'user-agent': WebPageGateway.AGENT,
            accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
            'accept-language': 'ko,en;q=0.8',
          },
          // 확인한 주소로만 붙는다. 인증서는 원래 이름으로 확인한다 (url의 호스트를 그대로 둔다)
          lookup: (_name, options, done) => {
            if ((options as { all?: boolean }).all) done(null, [address]);
            else done(null, address.address, address.family);
          },
        },
        resolve,
      );
      req.on('error', reject);
      req.end();
    });
  }

  private async page(url: URL, res: IncomingMessage): Promise<WebPage> {
    const type = String(res.headers['content-type'] ?? 'text/html');
    if (!WebPageGateway.TEXT_TYPES.test(type)) {
      res.resume();
      throw new RuleViolation(
        `글이 아닌 형식이에요 (${type.split(';')[0]}). 파일은 주인이 재료로 올려야 해요`,
      );
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let cut = false;
    for await (const chunk of res as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= WebPageGateway.MAX_BYTES) {
        cut = true;
        res.destroy();
        break;
      }
    }
    const bytes = Buffer.concat(chunks).subarray(0, WebPageGateway.MAX_BYTES);
    const html = WebPageGateway.HTML_TYPES.test(type);
    const raw = WebPageGateway.decode(bytes, type, html);
    const meta = (names: readonly string[]) => (html ? HtmlText.meta(raw, names) : '');
    const title = (html ? HtmlText.title(raw) : '') || meta(['og:title']);
    const body = html ? HtmlText.body(raw) : raw.trim();
    const short = body.length > WebPageGateway.TEXT_MAX;
    return new WebPage(
      url.toString(),
      title,
      short ? body.slice(0, WebPageGateway.TEXT_MAX) : body,
      cut || short,
      (type.split(';')[0] ?? '').trim().toLowerCase(),
      meta(['og:site_name', 'application-name']).slice(0, 100),
      meta(['og:description', 'description', 'twitter:description']).slice(0, 300),
      WebPageGateway.absolute(meta(['og:image', 'og:image:url', 'twitter:image']), url),
    );
  }

  /** 메타 태그의 그림 주소를 페이지 기준의 http(s) 주소로. 아니면 null */
  private static absolute(src: string, base: URL): string | null {
    if (!src || src.length > 2000 || !URL.canParse(src, base.toString())) return null;
    const url = new URL(src, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  }

  /** 머리글 · <meta>의 문자 집합으로 (euc-kr 같은 옛 한국어 페이지). 모르는 이름이면 utf-8 */
  private static decode(bytes: Buffer, type: string, html: boolean): string {
    const label =
      /charset=["']?([\w-]+)/i.exec(type)?.[1] ??
      (html ? HtmlText.metaCharset(bytes.subarray(0, 4096).toString('latin1')) : null) ??
      'utf-8';
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}
