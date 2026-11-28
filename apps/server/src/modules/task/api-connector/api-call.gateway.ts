import type { IncomingMessage } from 'node:http';
import { ExternalFailure } from '../../platform';
import { PublicHttpsGateway } from '../web/public-https.gateway';
import type { ApiRequest } from './api-operation.policy';

/** 서비스의 답 하나: 상태 코드와 JSON 본문(JSON이 아니면 글자) */
export class ApiAnswer {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

// API 커넥터의 요청을 보내는 길 하나 (2026-11-24): 정의서대로 만든 요청(ApiRequest)과 키 머리글만 보낸다.
// 바깥에 붙는 규칙은 PublicHttpsGateway (https만 · 내부망 막기 · 확인한 주소로만). API 요청은 리다이렉트를 따라가지 않는다
// (키가 다른 곳으로 가지 않게). 파일 받기는 키를 싣지 않고, GET 리다이렉트를 MAX_HOPS번까지 매번 다시 확인하며 따라간다.
// 키 · 본문은 로그와 오류 글에 싣지 않는다. 오류 글에는 상태 코드와 서비스가 준 짧은 까닭만
export class ApiCallGateway extends PublicHttpsGateway {
  static readonly ANSWER_MAX = 2 * 1024 * 1024;
  static readonly MAX_HOPS = 3;
  /** 파일 하나를 받는 시간 */
  static readonly FILE_MS = 5 * 60_000;
  protected readonly name = 'API 커넥터';
  protected readonly agent = 'Moida/1.0 (API connector)';
  protected override readonly timeoutMs = 30_000;

  /** 요청 하나. 2xx가 아니면 실패 (상태 코드 · 짧은 까닭) */
  async send(req: ApiRequest, headers: Readonly<Record<string, string>>): Promise<ApiAnswer> {
    const target = await this.pin(req.url);
    const sendHeaders = {
      accept: 'application/json',
      ...(req.body === null ? {} : { 'content-type': 'application/json' }),
      ...headers,
    };
    const answer = await this.call(async (signal) => {
      const res = await this.open(target, req.method, sendHeaders, req.body, signal);
      const text = (await PublicHttpsGateway.readAll(res, ApiCallGateway.ANSWER_MAX)).toString(
        'utf8',
      );
      const json = PublicHttpsGateway.json(text);
      return new ApiAnswer(res.statusCode ?? 0, json ?? text.slice(0, 2000));
    });
    if (answer.status < 200 || answer.status >= 300)
      throw new ExternalFailure(
        `서비스가 ${answer.status}로 답했어요${ApiCallGateway.reason(answer.body)}`,
      );
    return answer;
  }

  /** 파일 하나를 흘려 받아 consume에 넘긴다 (키 없이). 형식은 서비스가 알린 content-type */
  async download<T>(
    url: string,
    consume: (body: AsyncIterable<Uint8Array>, type: string | null) => Promise<T>,
  ): Promise<T> {
    const signal = AbortSignal.timeout(ApiCallGateway.FILE_MS);
    let next = new URL(url);
    for (let hop = 0; hop <= ApiCallGateway.MAX_HOPS; hop++) {
      const target = await this.pin(next);
      const res: IncomingMessage = await this.open(target, 'GET', {}, null, signal).catch(
        (e: unknown) => {
          throw new ExternalFailure(
            `파일을 받지 못했어요: ${e instanceof Error ? e.message : String(e)}`,
          );
        },
      );
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        next = new URL(location, next);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new ExternalFailure(`파일 주소가 ${status}로 답했어요`);
      }
      return consume(res as AsyncIterable<Uint8Array>, res.headers['content-type'] ?? null);
    }
    throw new ExternalFailure(`파일 주소가 ${ApiCallGateway.MAX_HOPS}번 넘게 넘어가요`);
  }

  /** 서비스가 준 실패 까닭 (message · error · detail 중 앞 200자) */
  private static reason(body: unknown): string {
    if (body === null || typeof body !== 'object') return '';
    const b = body as Record<string, unknown>;
    const found = [b.message, b.error, b.detail].find((v) => typeof v === 'string');
    return typeof found === 'string' ? `: ${found.slice(0, 200)}` : '';
  }
}
