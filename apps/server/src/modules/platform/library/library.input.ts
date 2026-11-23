import { BaseRequest } from '../base/base-request';

/**
 * 보관함 읽기 (GET /api/library?kind=&project=&from=&to=&q=&cursor=). 모듈마다 같은 거르기를 받는다.
 * kind: 한 종류만 (없으면 모두), project: 프로젝트를 아는 종류(세션)만 남는다, from · to: 그 사이에 바뀐 것,
 * q: 제목에 이 글자가 든 것 (대화의 참조 고르기, 2026-11-15), cursor: 앞 쪽 응답의 next 그대로 (그보다 앞선 것부터).
 * ids: 이 id들만 (서버 안에서만, LibraryQuery.describe가 대화의 참조를 확인할 때)
 */
export class LibraryInput extends BaseRequest {
  static readonly PAGE = 30;
  private static readonly CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([0-9a-f-]{36})$/;

  private constructor(
    readonly kind: string | null,
    readonly project: string | null,
    readonly from: Date | null,
    readonly to: Date | null,
    /** 이 시각 · id보다 앞선 것부터 */
    readonly before: readonly [Date, string] | null,
    readonly q: string | null = null,
    readonly ids: readonly string[] | null = null,
  ) {
    super();
  }

  /** 이 id들의 줄만 (LibraryQuery.describe). 기간 · 커서 없이 */
  static forIds(ids: readonly string[]): LibraryInput {
    return new LibraryInput(null, null, null, null, null, null, ids);
  }

  static from(query: unknown): LibraryInput {
    return BaseRequest.read(query, (f) => {
      const cursor = f.optionalText('cursor', 200);
      const match = LibraryInput.CURSOR.exec(
        cursor ? Buffer.from(cursor, 'base64url').toString() : '',
      );
      if (cursor && !match) f.reject('cursor', '앞 쪽 응답의 next 값을 그대로 보내 주세요');
      return new LibraryInput(
        f.optionalText('kind', 20),
        f.optionalText('project', 100),
        f.optionalDate('from'),
        f.optionalDate('to'),
        match?.[1] && match[2] ? [new Date(match[1]), match[2]] : null,
        f.optionalText('q', 100)?.trim() || null,
      );
    });
  }

  /** 다음 쪽을 부를 값: 이 쪽의 마지막 줄 */
  static cursorAfter(at: Date, id: string): string {
    return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
  }

  /** 이 종류를 읽어야 하는가 (kind를 정하지 않았거나 그 종류) */
  wants(kind: string): boolean {
    return this.kind === null || this.kind === kind;
  }
}

/**
 * 보관함에서 골라 휴지통으로 (POST /api/library/trash { items: [{ kind, id }] }, 2026-11-23 일괄 지우기).
 * 한 번에 100개까지. 같은 줄을 두 번 보내도 한 번으로 친다
 */
export class TrashLibraryInput extends BaseRequest {
  static readonly MAX = 100;

  private constructor(
    /** 종류 → 그 종류의 id들 (보낸 순서대로, 겹치지 않게) */
    readonly byKind: ReadonlyMap<string, readonly string[]>,
  ) {
    super();
  }

  static from(raw: unknown): TrashLibraryInput {
    return BaseRequest.read(raw, (f) => {
      const items = f.nestedList('items', TrashLibraryInput.MAX).map((item) => ({
        kind: item.text('kind', 20),
        id: item.uuid('id'),
      }));
      if (items.length === 0) f.reject('items', '지울 것을 하나 이상 골라요');
      const byKind = new Map<string, string[]>();
      for (const { kind, id } of items) {
        const ids = byKind.get(kind) ?? [];
        if (!ids.includes(id)) ids.push(id);
        byKind.set(kind, ids);
      }
      return new TrashLibraryInput(byKind);
    });
  }
}
