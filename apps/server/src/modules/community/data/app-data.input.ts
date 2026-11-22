import { BaseRequest } from '../../platform';

/** 표 이름: 선언 목록에서 찾을 글자 (없는 이름은 없는 표와 같다) */
const TABLE_MAX = 40;

/**
 * GET api/community/data/:table?<칸>=<연산>.<값>&order=<칸>.asc|desc&limit=&offset=: 줄 읽기 (스토어 12.4).
 * 조건의 칸 · 연산 · 값은 표의 선언(AppTable.filterOf)이 본다
 */
export class DataListInput extends BaseRequest {
  static readonly LIMIT = 50;
  static readonly LIMIT_MAX = 100;
  static readonly OFFSET_MAX = 10_000;
  private static readonly RESERVED: readonly string[] = ['order', 'limit', 'offset'];

  private constructor(
    readonly table: string,
    /** 칸 → `<연산>.<값>` */
    readonly filters: ReadonlyMap<string, string>,
    /** 정렬할 칸과 오름차순 여부. 기본은 최근부터 (id는 만든 순서다) */
    readonly order: readonly [string, boolean],
    readonly limit: number,
    readonly offset: number,
  ) {
    super();
  }

  static from(table: string, query: unknown): DataListInput {
    const q = (query ?? {}) as Record<string, unknown>;
    const filters = new Map<string, string>();
    for (const [key, value] of Object.entries(q))
      if (!DataListInput.RESERVED.includes(key) && typeof value === 'string')
        filters.set(key.slice(0, TABLE_MAX), value.slice(0, 2_000));
    const order = String(q.order ?? 'id.desc');
    const dot = order.lastIndexOf('.');
    return BaseRequest.read(
      {
        table,
        limit: q.limit === undefined ? null : Number(q.limit),
        offset: q.offset === undefined ? null : Number(q.offset),
      },
      (f) =>
        new DataListInput(
          f.text('table', TABLE_MAX),
          filters,
          [dot < 0 ? order : order.slice(0, dot), dot >= 0 && order.slice(dot + 1) === 'asc'],
          f.optionalInteger('limit', 1, DataListInput.LIMIT_MAX) ?? DataListInput.LIMIT,
          f.optionalInteger('offset', 0, DataListInput.OFFSET_MAX) ?? 0,
        ),
    );
  }
}

/** POST api/community/data/:table 의 본문: 칸 → 값 (모양은 AppTable.checked가 본다) */
export class DataWriteInput extends BaseRequest {
  private constructor(
    readonly table: string,
    readonly values: unknown,
  ) {
    super();
  }

  static from(table: string, body: unknown): DataWriteInput {
    return BaseRequest.read({ table }, (f) => new DataWriteInput(f.text('table', TABLE_MAX), body));
  }
}

/** PATCH api/community/data/:table/:id 의 본문: 바꿀 칸 → 값 */
export class DataEditInput extends BaseRequest {
  private constructor(
    readonly table: string,
    readonly id: string,
    readonly values: unknown,
  ) {
    super();
  }

  static from(table: string, id: string, body: unknown): DataEditInput {
    return BaseRequest.read(
      { table, id },
      (f) => new DataEditInput(f.text('table', TABLE_MAX), f.uuid('id'), body),
    );
  }
}

/** 줄 하나 (DELETE api/community/data/:table/:id) */
export class DataRowInput extends BaseRequest {
  private constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super();
  }

  static from(table: string, id: string): DataRowInput {
    return BaseRequest.read(
      { table, id },
      (f) => new DataRowInput(f.text('table', TABLE_MAX), f.uuid('id')),
    );
  }
}

/** 관리자의 표 하나 읽기: api/community/admin/:appId/data/:table (조건은 회원 쪽과 같다) */
export class AdminDataInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly list: DataListInput,
  ) {
    super();
  }

  static from(appId: string, table: string, query: unknown): AdminDataInput {
    const list = DataListInput.from(table, query);
    return BaseRequest.read({ appId }, (f) => new AdminDataInput(f.uuid('appId'), list));
  }
}

/** 앱 하나 (관리자의 표 목록 · 내보내기) */
export class AdminAppInput extends BaseRequest {
  private constructor(readonly appId: string) {
    super();
  }

  static from(appId: string): AdminAppInput {
    return BaseRequest.read({ appId }, (f) => new AdminAppInput(f.uuid('appId')));
  }
}

/**
 * 관리자 · 승인받은 일꾼이 줄을 넣는다: POST api/community/admin/:appId/data/:table { rows: [{ 칸: 값 }] } (200줄까지).
 * 설정 제안(app_data)의 값도 같은 모양이다 (스토어 12.4)
 */
export class AdminRowsInput extends BaseRequest {
  static readonly ROWS_MAX = 200;

  private constructor(
    readonly appId: string,
    readonly table: string,
    readonly rows: readonly unknown[],
  ) {
    super();
  }

  static from(appId: string, table: string, body: unknown): AdminRowsInput {
    const rows = (body as { rows?: unknown } | null)?.rows;
    return BaseRequest.read({ appId, table }, (f) => {
      if (!Array.isArray(rows) || rows.length === 0 || rows.length > AdminRowsInput.ROWS_MAX)
        f.reject('rows', `줄은 1~${AdminRowsInput.ROWS_MAX}개의 목록으로 보내요`);
      return new AdminRowsInput(
        f.uuid('appId'),
        f.text('table', TABLE_MAX),
        Array.isArray(rows) ? rows : [],
      );
    });
  }
}

/** 관리자가 줄 하나를 지운다: DELETE api/community/admin/:appId/data/:table/:id */
export class AdminRowInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly table: string,
    readonly id: string,
  ) {
    super();
  }

  static from(appId: string, table: string, id: string): AdminRowInput {
    return BaseRequest.read(
      { appId, table, id },
      (f) => new AdminRowInput(f.uuid('appId'), f.text('table', TABLE_MAX), f.uuid('id')),
    );
  }
}

/** 이벤트 blog.app_code.shown의 내용: 보이게 된 버전이 선언한 표 (모양은 AppTable이 다시 본다) */
export class TablesShownInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly seq: number,
    readonly tables: Readonly<Record<string, unknown>>,
  ) {
    super();
  }

  static from(raw: unknown): TablesShownInput {
    const data = (raw ?? {}) as Record<string, unknown>;
    const tables = data.tables;
    return BaseRequest.read(
      data,
      (f) =>
        new TablesShownInput(
          f.uuid('appId'),
          f.integer('seq', 0, 2_147_483_647),
          tables !== null && typeof tables === 'object' && !Array.isArray(tables)
            ? (tables as Record<string, unknown>)
            : {},
        ),
    );
  }
}
