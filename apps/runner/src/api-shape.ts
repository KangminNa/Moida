/** 기록한 API 요청 하나의 모양 (값 없음): 사이트 도구를 만드는 AI가 화면 대신 부를 길을 고르는 재료 */
export type ApiCall = {
  method: string;
  origin: string;
  /** 경로의 틀: 숫자 · id처럼 생긴 조각은 {n} · {id} */
  path: string;
  /** 쿼리의 이름만 (값은 버린다) */
  query: string[];
  /** 요청 본문의 모양 (JSON이면 칸 이름과 종류, 폼이면 이름만). 없으면 null */
  body: unknown;
  status: number;
  contentType: string;
  /** JSON 답의 모양. JSON이 아니면 null */
  response: unknown;
};

// 요청의 모양만 남긴다 (B2 요청 기록, 2026-11-19). 값은 하나도 남기지 않는다: 문자열 · 숫자는 종류 이름으로,
// 경로의 숫자 · id 조각은 틀로, 쿼리 · 폼은 이름만. 머리글 · 쿠키는 보지 않는다. 개인정보처럼 생긴 칸 이름(이메일 · 긴 숫자)도 뺀다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 변환 한 곳. NetworkTap이 쓴다
export class ApiShape {
  private static readonly DEPTH = 4;
  private static readonly KEYS = 30;
  private static readonly KEY_MAX = 60;

  /** 경로의 틀: /users/123/orders/9f1c… → /users/{n}/orders/{id} */
  static pathOf(pathname: string): string {
    return pathname
      .split('/')
      .map((part) => {
        if (/^\d+$/.test(part)) return '{n}';
        if (/^[0-9a-f-]{16,}$/i.test(part) || /^[A-Za-z0-9_-]{24,}$/.test(part)) return '{id}';
        return part.length > 60 ? '{id}' : part;
      })
      .join('/')
      .slice(0, 300);
  }

  /** 쿼리의 이름 (정렬, 중복 없이, 20개까지) */
  static queryOf(search: URLSearchParams): string[] {
    return [...new Set([...search.keys()].filter(ApiShape.keyOk))].sort().slice(0, 20);
  }

  /** 요청 본문의 모양: JSON이면 shapeOf, 폼이면 이름만, 그 밖은 null */
  static bodyOf(text: string | null, contentType: string): unknown {
    if (!text) return null;
    if (/json/i.test(contentType)) {
      try {
        return ApiShape.shapeOf(JSON.parse(text), 0);
      } catch {
        return null;
      }
    }
    if (/x-www-form-urlencoded/i.test(contentType))
      return Object.fromEntries(
        ApiShape.queryOf(new URLSearchParams(text)).map((k) => [k, 'string']),
      );
    return null;
  }

  /** 값의 모양: 종류 이름 · 칸 이름 · 목록의 첫 항목 (깊이 4 · 칸 30개까지) */
  static shapeOf(value: unknown, depth: number): unknown {
    if (value === null) return 'null';
    if (Array.isArray(value))
      return depth >= ApiShape.DEPTH || value.length === 0
        ? []
        : [ApiShape.shapeOf(value[0], depth + 1)];
    if (typeof value === 'object') {
      if (depth >= ApiShape.DEPTH) return {};
      const keys = Object.keys(value).filter(ApiShape.keyOk).slice(0, ApiShape.KEYS);
      return Object.fromEntries(
        keys.map((k) => [k, ApiShape.shapeOf((value as Record<string, unknown>)[k], depth + 1)]),
      );
    }
    return typeof value;
  }

  /** 칸 이름으로 남겨도 되는가: 짧고, 이메일 · 긴 숫자 · 토큰처럼 생기지 않은 것 */
  private static keyOk(key: string): boolean {
    return (
      key.length > 0 &&
      key.length <= ApiShape.KEY_MAX &&
      !key.includes('@') &&
      !/^\d{6,}$/.test(key) &&
      !/^[A-Za-z0-9_-]{32,}$/.test(key)
    );
  }
}
