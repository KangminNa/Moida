import { RuleViolation } from '../../platform';
import { JsonPick } from './json-pick.policy';
import { type ApiField, type ApiPoll, SpecReader } from './spec-reader.policy';

type Raw = Record<string, unknown>;
/** 동작의 성격: read(조회, 무료) · spend(크레딧을 씀, 하루 한도) · write(바깥에 남김, 부를 때마다 승인) */
export type ApiEffect = 'read' | 'spend' | 'write';
const EFFECTS: readonly ApiEffect[] = ['read', 'spend', 'write'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** 보낼 요청 하나 (주소는 정의서의 기본 주소 아래) */
export class ApiRequest {
  constructor(
    readonly method: string,
    readonly url: URL,
    readonly body: string | null,
  ) {}
}

// API 커넥터의 동작 하나 (2026-11-24, 정의서 operations[]): 입력 칸 · 주소 틀 · 본문 틀 · 꺼낼 칸 · 상태 묻기 · 파일 칸.
// AI가 쓴 정의서를 여기서 거르고(from), 부를 때 입력을 보고 요청을 만든다 (서버의 고정 코드가 보낸다)
export class ApiOperation {
  /** 받을 파일 주소: https만 (시험의 가짜 서버 루프백은 http도. 게이트웨이가 시험 스위치 없이는 http를 열지 않는다) */
  private static readonly FILE_URL = /^(https:\/\/|http:\/\/(127\.0\.0\.1|\[::1\])[:/])/;
  private static readonly NAME = /^[a-z][a-z0-9_]{1,39}$/;

  constructor(
    readonly name: string,
    readonly title: string,
    readonly effect: ApiEffect,
    readonly method: (typeof METHODS)[number],
    readonly path: string,
    readonly fields: readonly ApiField[],
    readonly query: readonly string[],
    readonly body: unknown,
    readonly pick: Readonly<Record<string, string>> | null,
    readonly poll: ApiPoll | null,
    readonly files: readonly string[],
  ) {}

  /** AI가 쓴 동작 하나를 거른다 */
  static from(raw: unknown, at: string): ApiOperation {
    const op = SpecReader.object(raw, at);
    const name = SpecReader.text(op.name, `${at}.name`, 40);
    if (!ApiOperation.NAME.test(name))
      throw new RuleViolation(`${at}.name: 영문 소문자로 시작하는 소문자 · 숫자 · _ 40자까지예요`);
    const effect = op.effect as ApiEffect;
    if (!EFFECTS.includes(effect))
      throw new RuleViolation(`${at}.effect: read · spend · write 중 하나예요`);
    const method = String(op.method ?? '').toUpperCase() as (typeof METHODS)[number];
    if (!METHODS.includes(method))
      throw new RuleViolation(`${at}.method: ${METHODS.join(' · ')} 중 하나예요`);
    const path = SpecReader.pathOf(op.path, `${at}.path`);
    const fields = SpecReader.fieldsOf(op.input ?? {}, `${at}.input`);
    const names = new Set(fields.map((f) => f.name));
    for (const hole of SpecReader.holes(path))
      if (!names.has(hole)) throw new RuleViolation(`${at}.path: {${hole}}가 입력에 없어요`);
    const query = SpecReader.list(op.query ?? [], `${at}.query`, 30);
    for (const q of query)
      if (!names.has(q)) throw new RuleViolation(`${at}.query: ${q}가 입력에 없어요`);
    if (op.body !== undefined && (method === 'GET' || method === 'DELETE'))
      throw new RuleViolation(`${at}.body: ${method}는 본문을 보내지 않아요`);
    if (op.body !== undefined && JSON.stringify(op.body).length > 8000)
      throw new RuleViolation(`${at}.body: 본문 틀은 8,000자까지예요`);
    const pick = op.pick === undefined ? null : SpecReader.picks(op.pick, `${at}.pick`);
    const poll =
      op.poll === undefined ? null : SpecReader.pollOf(op.poll, `${at}.poll`, names, pick);
    const files = SpecReader.list(op.files ?? [], `${at}.files`, 5).map((p, i) =>
      JsonPick.check(p, `${at}.files[${i}]`),
    );
    const title = SpecReader.text(op.title, `${at}.title`, 60);
    return new ApiOperation(
      name,
      title,
      effect,
      method,
      path,
      fields,
      query,
      op.body,
      pick,
      poll,
      files,
    );
  }

  /** 받은 입력을 칸 규칙으로 본다. 모르는 칸 · 빠진 칸이면 RuleViolation */
  inputOf(raw: unknown): Raw {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new RuleViolation('입력은 객체예요');
    const input = raw as Raw;
    const known = new Map(this.fields.map((f) => [f.name, f]));
    for (const key of Object.keys(input))
      if (!known.has(key)) throw new RuleViolation(`모르는 입력 칸이에요: ${key}`);
    const out: Raw = {};
    for (const f of this.fields) {
      if (input[f.name] === undefined || input[f.name] === null) {
        if (f.required) throw new RuleViolation(`입력 ${f.name}이 필요해요`);
        continue;
      }
      out[f.name] = f.check(input[f.name]);
    }
    return out;
  }

  /** 첫 요청: 주소 틀 · 쿼리 · 본문을 입력으로 채운다 (입력은 inputOf를 지난 것) */
  request(base: string, input: Raw): ApiRequest {
    const url = ApiOperation.urlOf(base, this.path, input);
    for (const q of this.query)
      if (input[q] !== undefined) url.searchParams.set(q, ApiOperation.flat(input[q]));
    if (this.method === 'GET' || this.method === 'DELETE')
      return new ApiRequest(this.method, url, null);
    const used = new Set([...SpecReader.holes(this.path), ...this.query]);
    const body =
      this.body === undefined
        ? Object.fromEntries(Object.entries(input).filter(([k]) => !used.has(k)))
        : ApiOperation.fill(this.body, input);
    return new ApiRequest(this.method, url, JSON.stringify(body ?? {}));
  }

  /** 상태 묻기 요청: 주소 틀을 첫 답에서 꺼낸 값 · 입력으로 채운다 */
  pollRequest(base: string, vars: Raw): ApiRequest | null {
    return this.poll
      ? new ApiRequest('GET', ApiOperation.urlOf(base, this.poll.path, vars), null)
      : null;
  }

  /** AI에게 돌려줄 값: 꺼낼 칸이 있으면 그것만, 없으면 답 전체 */
  picked(answer: unknown, polled: boolean): unknown {
    const pick = (polled ? this.poll?.pick : null) ?? this.pick;
    if (!pick) return answer;
    return Object.fromEntries(
      Object.entries(pick).map(([k, p]) => [k, JsonPick.get(answer, p) ?? null]),
    );
  }

  /** 끝난 답의 파일 주소 (https만, 10개까지) */
  fileUrls(answer: unknown): string[] {
    const urls = this.files.flatMap((p) => JsonPick.strings(answer, p));
    return [
      ...new Set(urls.filter((u) => ApiOperation.FILE_URL.test(u) && u.length <= 2000)),
    ].slice(0, 10);
  }

  json(): Raw {
    return {
      name: this.name,
      title: this.title,
      effect: this.effect,
      method: this.method,
      path: this.path,
      input: Object.fromEntries(this.fields.map((f) => [f.name, f.json()])),
      ...(this.query.length ? { query: this.query } : {}),
      ...(this.body !== undefined ? { body: this.body } : {}),
      ...(this.pick ? { pick: this.pick } : {}),
      ...(this.poll ? { poll: this.poll.json() } : {}),
      ...(this.files.length ? { files: this.files } : {}),
    };
  }

  /** 기본 주소 + 경로 틀. 채운 값은 한 조각으로 인코딩해 경로를 벗어나지 못한다 */
  private static urlOf(base: string, path: string, vars: Raw): URL {
    const filled = path.replace(SpecReader.HOLE, (_m, name: string) => {
      const value = vars[name];
      if (value === undefined || value === null || typeof value === 'object')
        throw new RuleViolation(`주소를 채울 값이 없어요: ${name}`);
      return encodeURIComponent(String(value));
    });
    const url = new URL(`${base.replace(/\/$/, '')}${filled}`);
    if (url.origin !== new URL(base).origin) throw new RuleViolation('기본 주소를 벗어나요');
    return url;
  }

  /** 본문 틀 채우기: "{칸}" 하나뿐인 글은 그 값(없으면 빼기), 섞인 글은 글자로 끼우기 */
  private static fill(template: unknown, input: Raw): unknown {
    if (typeof template === 'string') {
      const whole = /^\{([A-Za-z_][A-Za-z0-9_]{0,39})\}$/.exec(template);
      if (whole) return input[whole[1] ?? ''];
      return template.replace(SpecReader.HOLE, (_m, n: string) =>
        input[n] === undefined ? '' : ApiOperation.flat(input[n]),
      );
    }
    if (Array.isArray(template))
      return template.map((t) => ApiOperation.fill(t, input)).filter((v) => v !== undefined);
    if (template !== null && typeof template === 'object') {
      const out: Raw = {};
      for (const [k, v] of Object.entries(template)) {
        const value = ApiOperation.fill(v, input);
        if (value !== undefined) out[k] = value;
      }
      return out;
    }
    return template;
  }

  private static flat(value: unknown): string {
    return Array.isArray(value) ? value.join(',') : String(value);
  }
}
