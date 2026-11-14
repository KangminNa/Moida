import type { PageDataChange } from './page.view';

// 자라는 페이지의 바뀐 점 (2차 5단계): 두 판의 data.json을 잎(값)까지 펼쳐 더해진 것 · 빠진 것 · 바뀐 것을 낸다.
// 경로는 `places[2].name` 모양. 화면에 보일 만큼만 (CHANGES_MAX개, 값은 VALUE_MAX자)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 페이지의 판을 비교할 때만 쓴다
export class PageDataDiff {
  static readonly CHANGES_MAX = 100;
  private static readonly VALUE_MAX = 200;
  /** 너무 깊은 데이터는 그 자리를 값 하나로 본다 */
  private static readonly DEPTH_MAX = 12;

  /** before가 undefined면(첫 판 · 앞 판에 data.json 없음) 모두 더해진 것. null은 값 null이다 */
  static between(
    before: unknown,
    after: unknown,
  ): { changes: PageDataChange[]; truncated: boolean } {
    const old = PageDataDiff.leaves(before);
    const now = PageDataDiff.leaves(after);
    const changes: PageDataChange[] = [];
    for (const [path, value] of now) {
      const was = old.get(path);
      if (was === undefined) changes.push(PageDataDiff.change(path, 'added', null, value));
      else if (was !== value) changes.push(PageDataDiff.change(path, 'changed', was, value));
    }
    for (const [path, value] of old)
      if (!now.has(path)) changes.push(PageDataDiff.change(path, 'removed', value, null));
    return {
      changes: changes.slice(0, PageDataDiff.CHANGES_MAX),
      truncated: changes.length > PageDataDiff.CHANGES_MAX,
    };
  }

  /** 경로 → 값(JSON 글자). 빈 객체 · 빈 배열도 값 하나 */
  private static leaves(value: unknown, path = '', depth = 0, out = new Map<string, string>()) {
    if (value === undefined) return out;
    const nested = typeof value === 'object' && value !== null;
    const entries = nested
      ? Array.isArray(value)
        ? value.map((v, i) => [`${path}[${i}]`, v] as const)
        : Object.entries(value).map(([k, v]) => [path ? `${path}.${k}` : k, v] as const)
      : [];
    if (!nested || entries.length === 0 || depth >= PageDataDiff.DEPTH_MAX) {
      out.set(path || '(전체)', JSON.stringify(value));
      return out;
    }
    for (const [key, child] of entries) PageDataDiff.leaves(child, key, depth + 1, out);
    return out;
  }

  private static change(
    path: string,
    kind: string,
    before: string | null,
    after: string | null,
  ): PageDataChange {
    const cut = (v: string | null) => (v === null ? null : v.slice(0, PageDataDiff.VALUE_MAX));
    return { path, kind, before: cut(before), after: cut(after) };
  }
}
