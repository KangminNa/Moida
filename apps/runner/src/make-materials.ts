/** 만들기 작업의 재료 id (payload.make). 서버가 이미 걸렀지만 지시문 · 도구 입력에 쓰기 전에 모양을 다시 본다 */
export class MakeMaterials {
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  private static readonly MAX = 10;

  private constructor(
    readonly outputs: readonly string[],
    readonly wikis: readonly string[],
  ) {}

  static from(payload: unknown): MakeMaterials {
    const make = (typeof payload === 'object' && payload !== null ? payload : {}) as {
      outputs?: unknown;
      wikis?: unknown;
    };
    return new MakeMaterials(MakeMaterials.ids(make.outputs), MakeMaterials.ids(make.wikis));
  }

  private static ids(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const ids = raw.filter((v): v is string => typeof v === 'string' && MakeMaterials.UUID.test(v));
    return [...new Set(ids)].slice(0, MakeMaterials.MAX);
  }
}
