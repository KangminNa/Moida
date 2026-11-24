import { RuleViolation } from '../../platform';

// API 커넥터 정의서의 칸 가리키기 (2026-11-24): 답의 JSON에서 값을 꺼내는 짧은 경로.
//   "id" · "data.status" · "images[0].url" · "images[*].url"(배열 모두) · ""(답 전체)
// 함수 · 걸러 내기는 없다 (정의서는 AI가 쓰므로 고정된 작은 문법만 받는다)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class JsonPick {
  static readonly MAX = 120;
  private static readonly PATH =
    /^(?:[A-Za-z_][\w-]{0,40}(?:\[(?:\d{1,3}|\*)\])*)(?:\.[A-Za-z_][\w-]{0,40}(?:\[(?:\d{1,3}|\*)\])*)*$/;

  /** 경로의 모양을 본다. 틀리면 RuleViolation (what은 오류 글의 자리) */
  static check(path: unknown, what: string): string {
    if (typeof path !== 'string' || path.length > JsonPick.MAX)
      throw new RuleViolation(`${what}: 경로는 ${JsonPick.MAX}자까지의 글이에요`);
    if (path !== '' && !JsonPick.PATH.test(path))
      throw new RuleViolation(
        `${what}: 경로 모양이 맞지 않아요 (예: data.items[0].url · images[*].url)`,
      );
    return path;
  }

  /** 값을 꺼낸다. [*]가 있으면 배열로, 없으면 하나(없으면 undefined) */
  static get(value: unknown, path: string): unknown {
    if (path === '') return value;
    let found: unknown[] = [value];
    let many = false;
    for (const part of JsonPick.parts(path)) {
      const next: unknown[] = [];
      for (const v of found) {
        if (part === '*') {
          many = true;
          if (Array.isArray(v)) next.push(...v);
        } else if (typeof part === 'number') {
          if (Array.isArray(v) && part < v.length) next.push(v[part]);
        } else if (
          v !== null &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          Object.hasOwn(v, part)
        )
          next.push((v as Record<string, unknown>)[part]);
      }
      found = next;
    }
    return many ? found : found[0];
  }

  /** 꺼낸 값들 가운데 글자만 (파일 주소 모으기) */
  static strings(value: unknown, path: string): string[] {
    const got = JsonPick.get(value, path);
    return (Array.isArray(got) ? got : [got]).filter((v): v is string => typeof v === 'string');
  }

  private static parts(path: string): (string | number)[] {
    const out: (string | number)[] = [];
    for (const m of path.matchAll(/([A-Za-z_][\w-]*)|\[(\d+|\*)\]/g)) {
      if (m[1] !== undefined) out.push(m[1]);
      else if (m[2] === '*') out.push('*');
      else out.push(Number(m[2]));
    }
    return out;
  }
}
