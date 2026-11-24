import { RuleViolation } from '../../platform';
import { JsonPick } from './json-pick.policy';

type Raw = Record<string, unknown>;
const TYPES = ['string', 'integer', 'number', 'boolean', 'string[]'] as const;

/** 입력 칸 하나의 규칙 */
export class ApiField {
  constructor(
    readonly name: string,
    readonly type: (typeof TYPES)[number],
    readonly required: boolean,
    readonly choices: readonly (string | number)[] | null,
    readonly max: number | null,
    readonly help: string,
  ) {}

  /** 받은 값을 이 칸의 규칙으로 본다 */
  check(value: unknown): unknown {
    const bad = (why: string) => new RuleViolation(`입력 ${this.name}: ${why}`);
    if (this.type === 'string[]') {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
        throw bad('글자 목록이어야 해요');
      if (value.length > 50) throw bad('50개까지예요');
      return value;
    }
    if (this.type === 'boolean') {
      if (typeof value !== 'boolean') throw bad('참 · 거짓이어야 해요');
      return value;
    }
    if (this.type === 'string') {
      if (typeof value !== 'string') throw bad('글자여야 해요');
      if (value.length > (this.max ?? SpecReader.TEXT_MAX)) throw bad('너무 길어요');
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw bad('숫자여야 해요');
      if (this.type === 'integer' && !Number.isInteger(value)) throw bad('정수여야 해요');
      if (this.max !== null && value > this.max) throw bad(`${this.max} 이하여야 해요`);
    }
    if (this.choices && !this.choices.includes(value as string | number))
      throw bad(`${this.choices.join(' · ')} 중 하나예요`);
    return value;
  }

  json(): Raw {
    return {
      type: this.type,
      ...(this.required ? { required: true } : {}),
      ...(this.choices ? { enum: this.choices } : {}),
      ...(this.max !== null ? { max: this.max } : {}),
      ...(this.help ? { help: this.help } : {}),
    };
  }
}

/** 오래 걸리는 동작의 상태 다시 묻기 */
export class ApiPoll {
  constructor(
    readonly path: string,
    readonly everySeconds: number,
    readonly maxMinutes: number,
    readonly status: string,
    readonly done: readonly string[],
    readonly failed: readonly string[],
    readonly pick: Readonly<Record<string, string>> | null,
  ) {}

  /** 답의 상태: done · failed · waiting */
  stateOf(answer: unknown): 'done' | 'failed' | 'waiting' {
    const value = JsonPick.get(answer, this.status);
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    if (this.done.includes(text)) return 'done';
    if (this.failed.includes(text)) return 'failed';
    return 'waiting';
  }

  json(): Raw {
    return {
      path: this.path,
      every_seconds: this.everySeconds,
      max_minutes: this.maxMinutes,
      status: this.status,
      done: this.done,
      failed: this.failed,
      ...(this.pick ? { pick: this.pick } : {}),
    };
  }
}

// API 커넥터 정의서의 조각 읽기 (2026-11-24): AI가 쓴 JSON의 모양을 칸마다 거른다. 틀리면 자리(at)를 붙인 RuleViolation
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class SpecReader {
  static readonly TEXT_MAX = 20_000;
  static readonly FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
  static readonly HOLE = /\{([A-Za-z_][A-Za-z0-9_]{0,39})\}/g;

  static holes(path: string): string[] {
    return [...path.matchAll(SpecReader.HOLE)].map((m) => m[1] ?? '');
  }

  static pathOf(raw: unknown, at: string): string {
    const path = SpecReader.text(raw, at, 300);
    if (!path.startsWith('/') || /\.\.|\/\/|[?#\s\\]/.test(path))
      throw new RuleViolation(
        `${at}: /로 시작하는 경로예요 (.. · // · ? · # 없이, 쿼리는 query로)`,
      );
    return path;
  }

  static fieldsOf(raw: unknown, at: string): ApiField[] {
    const input = SpecReader.object(raw, at);
    const entries = Object.entries(input);
    if (entries.length > 30) throw new RuleViolation(`${at}: 입력 칸은 30개까지예요`);
    return entries.map(([name, value]) => {
      if (!SpecReader.FIELD.test(name))
        throw new RuleViolation(`${at}: 칸 이름이 맞지 않아요 (${name})`);
      const f = SpecReader.object(value, `${at}.${name}`);
      const type = f.type as (typeof TYPES)[number];
      if (!TYPES.includes(type))
        throw new RuleViolation(`${at}.${name}.type: ${TYPES.join(' · ')} 중 하나예요`);
      const choices = f.enum === undefined ? null : (f.enum as unknown[]);
      if (
        choices &&
        (!Array.isArray(choices) ||
          choices.length > 50 ||
          choices.some((c) => typeof c !== 'string' && typeof c !== 'number'))
      )
        throw new RuleViolation(`${at}.${name}.enum: 글자 · 숫자 50개까지예요`);
      const max = f.max === undefined ? null : Number(f.max);
      if (max !== null && !Number.isFinite(max))
        throw new RuleViolation(`${at}.${name}.max: 숫자예요`);
      const help = f.help === undefined ? '' : SpecReader.text(f.help, `${at}.${name}.help`, 200);
      return new ApiField(
        name,
        type,
        f.required === true,
        choices as (string | number)[] | null,
        max,
        help,
      );
    });
  }

  static pollOf(raw: unknown, at: string, names: Set<string>, pick: Raw | null): ApiPoll {
    const p = SpecReader.object(raw, at);
    const path = SpecReader.pathOf(p.path, `${at}.path`);
    const known = new Set([...names, ...Object.keys(pick ?? {})]);
    for (const hole of SpecReader.holes(path))
      if (!known.has(hole))
        throw new RuleViolation(`${at}.path: {${hole}}는 입력이나 pick에 있어야 해요`);
    const every = Number(p.every_seconds ?? 5);
    const minutes = Number(p.max_minutes ?? 15);
    if (!Number.isInteger(every) || every < 2 || every > 60)
      throw new RuleViolation(`${at}.every_seconds: 2~60초예요`);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)
      throw new RuleViolation(`${at}.max_minutes: 1~60분이에요`);
    const done = SpecReader.list(p.done, `${at}.done`, 10);
    if (done.length === 0) throw new RuleViolation(`${at}.done: 끝난 상태 값이 하나 이상 필요해요`);
    return new ApiPoll(
      path,
      every,
      minutes,
      JsonPick.check(p.status, `${at}.status`),
      done,
      SpecReader.list(p.failed ?? [], `${at}.failed`, 10),
      p.pick === undefined ? null : SpecReader.picks(p.pick, `${at}.pick`),
    );
  }

  static picks(raw: unknown, at: string): Record<string, string> {
    const entries = Object.entries(SpecReader.object(raw, at));
    if (entries.length > 20) throw new RuleViolation(`${at}: 20개까지예요`);
    return Object.fromEntries(
      entries.map(([k, p]) => {
        if (!SpecReader.FIELD.test(k)) throw new RuleViolation(`${at}: 이름이 맞지 않아요 (${k})`);
        return [k, JsonPick.check(p, `${at}.${k}`)];
      }),
    );
  }

  static list(raw: unknown, at: string, max: number): string[] {
    if (
      !Array.isArray(raw) ||
      raw.length > max ||
      raw.some((v) => typeof v !== 'string' || v.length > 120)
    )
      throw new RuleViolation(`${at}: 글자 ${max}개까지의 목록이에요`);
    return raw as string[];
  }

  static object(raw: unknown, at: string): Raw {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new RuleViolation(`${at}: 객체여야 해요`);
    return raw as Raw;
  }

  static text(raw: unknown, at: string, max: number): string {
    if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > max)
      throw new RuleViolation(`${at}: 1~${max}자 글이에요`);
    return raw.trim();
  }
}
