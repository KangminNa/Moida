import { RuleViolation } from '../../platform';
import { PublicAddress } from '../web/public-address.policy';
import { ApiOperation } from './api-operation.policy';
import { SpecReader } from './spec-reader.policy';

/** 키를 싣는 머리글 하나 (예: Authorization · Bearer, hf-api-key) */
export class ApiAuthHeader {
  constructor(
    readonly name: string,
    readonly prefix: string,
  ) {}

  /** 실을 값: 앞말이 있으면 "앞말 키" */
  value(key: string): string {
    return this.prefix ? `${this.prefix} ${key}` : key;
  }
}

// API 커넥터의 정의서 한 장 (2026-11-24, 기획서 결정 "도구를 찾아 붙이기"): 기본 주소 · 키를 싣는 머리글 · 동작 목록.
// 일꾼이 서비스의 API 문서(OpenAPI가 있으면 그것)를 읽고 JSON으로 써서 propose_api로 낸다. 서버는 여기서 거른 것만 저장하고,
// 실행은 서버의 고정 코드가 한다 (AI가 쓴 코드는 돌리지 않는다). 키 값은 정의서에 없다: 관리자가 콘솔에서 머리글마다 넣는다
//   { "base": "https://api.example.com/v1",
//     "auth": { "headers": [{ "name": "Authorization", "prefix": "Bearer" }] },
//     "operations": [{ "name": "make_image", "title": "그림 만들기", "effect": "spend", "method": "POST", "path": "/images",
//       "input": { "prompt": { "type": "string", "required": true } }, "pick": { "id": "id" },
//       "poll": { "path": "/images/{id}", "status": "status", "done": ["completed"], "failed": ["failed"] },
//       "files": ["output[*].url"] }] }
export class ApiSpec {
  static readonly OPERATIONS_MAX = 20;
  static readonly HEADERS_MAX = 3;
  private static readonly HEADER = /^[A-Za-z0-9-]{1,40}$/;
  private static readonly PREFIX = /^[A-Za-z][A-Za-z0-9-]{0,19}$/;
  /** 키를 싣지 않는 머리글: 요청의 모양을 바꾸는 것 */
  private static readonly RESERVED = [
    'host',
    'content-length',
    'content-type',
    'transfer-encoding',
    'connection',
    'cookie',
    'user-agent',
  ];

  constructor(
    readonly base: string,
    readonly headers: readonly ApiAuthHeader[],
    readonly operations: readonly ApiOperation[],
  ) {}

  /** AI가 쓴 정의서를 거른다. 틀리면 자리를 붙인 RuleViolation */
  static from(raw: unknown): ApiSpec {
    if (raw !== null && typeof raw === 'object' && JSON.stringify(raw).length > 60_000)
      throw new RuleViolation('정의서는 60,000자까지예요');
    const spec = SpecReader.object(raw, 'spec');
    const base = ApiSpec.baseOf(spec.base);
    const auth = spec.auth === undefined ? {} : SpecReader.object(spec.auth, 'spec.auth');
    const headers = ApiSpec.headersOf(auth.headers ?? []);
    if (
      !Array.isArray(spec.operations) ||
      spec.operations.length === 0 ||
      spec.operations.length > ApiSpec.OPERATIONS_MAX
    )
      throw new RuleViolation(`spec.operations: 동작 1~${ApiSpec.OPERATIONS_MAX}개예요`);
    const operations = spec.operations.map((op, i) =>
      ApiOperation.from(op, `spec.operations[${i}]`),
    );
    const names = new Set(operations.map((o) => o.name));
    if (names.size !== operations.length)
      throw new RuleViolation('spec.operations: 같은 이름의 동작이 있어요');
    return new ApiSpec(base, headers, operations);
  }

  /** 저장된 정의서 (이미 거른 것) */
  static stored(raw: unknown): ApiSpec {
    return ApiSpec.from(raw);
  }

  /** 이름으로 동작 하나. 없으면 RuleViolation */
  operation(name: string): ApiOperation {
    const op = this.operations.find((o) => o.name === name);
    if (!op)
      throw new RuleViolation(
        `없는 동작이에요: ${name} (${this.operations.map((o) => o.name).join(' · ')})`,
      );
    return op;
  }

  /** 저장하는 모양 (거른 값만) */
  json(): Record<string, unknown> {
    return {
      base: this.base,
      ...(this.headers.length
        ? {
            auth: {
              headers: this.headers.map((h) => ({
                name: h.name,
                ...(h.prefix ? { prefix: h.prefix } : {}),
              })),
            },
          }
        : {}),
      operations: this.operations.map((o) => o.json()),
    };
  }

  /** 기본 주소: https 출처 + 앞 경로. 내부망 주소를 그대로 적은 것은 받지 않는다 (이름은 부를 때 풀어 다시 본다) */
  private static baseOf(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length > 300)
      throw new RuleViolation('spec.base: 300자까지의 https 주소예요');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new RuleViolation('spec.base: 주소가 맞지 않아요');
    }
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && PublicAddress.isLoopback(url.hostname))
    )
      throw new RuleViolation('spec.base: https 주소만 받아요');
    if (url.username || url.password || url.search || url.hash)
      throw new RuleViolation('spec.base: 계정 · 쿼리 · # 없는 주소예요');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!PublicAddress.isLoopback(host) && /^[\d.]+$|:/.test(host))
      throw new RuleViolation('spec.base: 주소(IP)가 아니라 이름으로 적어요');
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  }

  private static headersOf(raw: unknown): ApiAuthHeader[] {
    if (!Array.isArray(raw) || raw.length > ApiSpec.HEADERS_MAX)
      throw new RuleViolation(
        `spec.auth.headers: 머리글 ${ApiSpec.HEADERS_MAX}개까지의 목록이에요`,
      );
    const seen = new Set<string>();
    return raw.map((h, i) => {
      const at = `spec.auth.headers[${i}]`;
      const one = SpecReader.object(h, at);
      const name = String(one.name ?? '');
      if (!ApiSpec.HEADER.test(name) || ApiSpec.RESERVED.includes(name.toLowerCase()))
        throw new RuleViolation(`${at}.name: 머리글 이름이 맞지 않아요 (예: Authorization)`);
      if (seen.has(name.toLowerCase())) throw new RuleViolation(`${at}.name: 같은 머리글이 있어요`);
      seen.add(name.toLowerCase());
      const prefix = one.prefix === undefined ? '' : String(one.prefix);
      if (prefix && !ApiSpec.PREFIX.test(prefix))
        throw new RuleViolation(`${at}.prefix: 앞말은 영문 20자까지예요 (예: Bearer)`);
      return new ApiAuthHeader(name, prefix);
    });
  }
}
