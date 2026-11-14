import { BaseRequest } from '../base/base-request';

/**
 * 보관함 읽기 (GET /api/library?kind=&project=&from=&to=&cursor=). 모듈마다 같은 거르기를 받는다.
 * kind: 한 종류만 (없으면 모두), project: 프로젝트를 아는 종류(세션)만 남는다, from · to: 그 사이에 바뀐 것,
 * cursor: 앞 쪽 응답의 next 그대로 (그보다 앞선 것부터)
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
  ) {
    super();
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
