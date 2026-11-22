import { BaseEntity, InvalidRequest, RuleViolation, TableEntity } from '../../platform';
import type {
  AppTableNew,
  AppTableReadRule,
  AppTableRow,
  AppTableWriteRule,
} from '../community.tables';

/** 조회의 조건 하나: 칸 · 연산 · 값 (값은 칸의 타입으로 바꾼 것) */
export interface AppDataFilter {
  column: string;
  op: string;
  value: unknown;
}

// 앱이 선언한 표 하나 (community.app_tables, 스토어 12.4). 실제 표는 앱마다의 스키마(schemaOf)에 있고, 이 줄이 그 표에서
// 지금 열려 있는 칸과 규칙을 말한다: 회원 쪽 API는 여기 있는 이름만 SQL에 쓰고, 값은 여기서 칸의 타입에 맞춰 검사한다.
// 선언에서 빠진 표는 닫힌다(open false). 표 · 칸을 DB에서 지우지는 않는다 (원칙 2).
export class AppTable extends TableEntity<AppTableRow, AppTableNew> {
  /** 모든 표에 Cairn이 붙이는 칸 */
  static readonly BUILT_IN: readonly string[] = ['id', 'owner', 'created_at', 'updated_at'];
  /** 선언의 타입 → Postgres 타입 */
  static readonly SQL_TYPES: Readonly<Record<string, string>> = {
    text: 'text',
    int: 'bigint',
    number: 'double precision',
    bool: 'boolean',
    time: 'timestamptz',
    json: 'jsonb',
  };
  static readonly OPS: Readonly<Record<string, string>> = {
    eq: '=',
    neq: '<>',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
  };
  static readonly TEXT_MAX = 10_000;
  static readonly JSON_BYTES_MAX = 16 * 1024;
  /** 표 하나의 줄 수 · 회원 하나가 표마다 둘 수 있는 줄 수 */
  static readonly ROWS_MAX = 100_000;
  static readonly ROWS_PER_MEMBER = 1_000;
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  private static readonly NAME = /^[a-z][a-z0-9_]{0,39}$/;

  /** 앱의 스키마 이름: app_<앱 id의 16진 32자> */
  static schemaOf(appId: string): string {
    const hex = appId.replaceAll('-', '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) throw AppTable.invalid('appId', '앱 id가 아니에요');
    return `app_${hex}`;
  }

  /** 새로 선언한 표 */
  static open(
    spaceId: string,
    appId: string,
    name: string,
    spec: unknown,
    seq: number,
    now: Date,
  ): AppTable {
    const { columns, read, write } = AppTable.specOf(name, spec);
    return new AppTable(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        app_id: appId,
        name,
        columns,
        read_rule: read,
        write_rule: write,
        open: true,
        applied_seq: seq,
        created_at: now,
        updated_at: now,
      },
      true,
    );
  }

  static restore(row: AppTableRow): AppTable {
    return new AppTable(row);
  }

  get appId(): string {
    return this.row.app_id;
  }

  get name(): string {
    return this.row.name;
  }

  /** 이 공간의 표인가 (대화의 설정 제안은 자기 공간의 표에만 넣는다) */
  inSpace(spaceId: string): boolean {
    return this.row.space_id === spaceId;
  }

  get isOpen(): boolean {
    return this.row.open;
  }

  get readRule(): AppTableReadRule {
    return this.row.read_rule;
  }

  get writeRule(): AppTableWriteRule {
    return this.row.write_rule;
  }

  /** 열려 있는 칸: 이름 → 선언의 타입 */
  get columns(): Readonly<Record<string, string>> {
    return this.row.columns as Record<string, string>;
  }

  /** 응답에 싣는 칸 이름 (붙인 칸 + 선언한 칸) */
  get columnNames(): readonly string[] {
    return [...AppTable.BUILT_IN, ...Object.keys(this.columns)];
  }

  /** 보이는 버전이 다시 선언했다: 칸 · 규칙을 그 선언으로 바꾸고 연다 */
  declare(spec: unknown, seq: number, now: Date): void {
    const { columns, read, write } = AppTable.specOf(this.row.name, spec);
    this.put('columns', columns);
    this.put('read_rule', read);
    this.put('write_rule', write);
    this.put('open', true);
    this.put('applied_seq', seq);
    this.put('updated_at', now);
  }

  /** 보이는 버전의 선언에서 빠졌다: API에서 닫는다 (표와 줄은 남는다) */
  close(seq: number, now: Date): void {
    if (!this.row.open) return;
    this.put('open', false);
    this.put('applied_seq', seq);
    this.put('updated_at', now);
  }

  /** 관리자의 표 목록 한 줄: 선언과 줄 수 (AppTablesView가 싣는다) */
  listed(rows: number): Readonly<AppTableRow> & { rows: number } {
    return { ...this.row, rows };
  }

  /** 회원 쪽에서 읽을 수 있는 표인가. 아니면 없는 표와 같다 */
  get memberReadable(): boolean {
    return this.row.open && this.row.read_rule !== 'admin';
  }

  /** 회원이 줄을 만들 수 있는가 · 자기 줄을 고치고 지울 수 있는가 */
  get memberInserts(): boolean {
    return this.row.open && this.row.write_rule !== 'admin';
  }

  get memberEdits(): boolean {
    return this.row.open && this.row.write_rule === 'owner';
  }

  /**
   * 쓰려는 값(JSON 객체)을 칸의 타입에 맞춰 검사하고 저장할 값으로 바꾼다. 모르는 칸 · 붙인 칸 · 틀린 타입은 RuleViolation.
   * 보내지 않은 칸은 건드리지 않는다 (만들 때는 NULL)
   */
  checked(raw: unknown): Record<string, unknown> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw AppTable.invalid('values', '값은 칸 이름 → 값의 객체로 보내요');
    const values: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(raw as Record<string, unknown>)) {
      const type = this.columns[column];
      if (type === undefined)
        throw new RuleViolation(`표 ${this.row.name}에 없는 칸이에요: ${column}`);
      values[column] = AppTable.valueAs(`${this.row.name}.${column}`, type, value);
    }
    if (Object.keys(values).length === 0) throw new RuleViolation('바꿀 값이 없어요');
    return values;
  }

  /**
   * 조회 조건 하나 (`<칸>=<연산>.<값>`). 붙인 칸(id · owner · created_at · updated_at)도 조건에 쓴다.
   * owner의 값 me는 지금 회원이다 (부르는 쪽이 바꾼다). 모르는 칸 · 연산은 InvalidRequest
   */
  filterOf(column: string, expression: string): AppDataFilter {
    const type = this.kindOf(column);
    const at = expression.indexOf('.');
    const op = at < 0 ? '' : expression.slice(0, at);
    if (!(op in AppTable.OPS))
      throw AppTable.invalid(
        column,
        `조건은 ${Object.keys(AppTable.OPS).join(' · ')}.<값>으로 적어요`,
      );
    if (type === 'json') throw AppTable.invalid(column, 'json 칸은 조건에 쓸 수 없어요');
    const text = expression.slice(at + 1);
    const parsed =
      type === 'int' || type === 'number'
        ? Number(text)
        : type === 'bool'
          ? text === 'true'
            ? true
            : text === 'false'
              ? false
              : Number.NaN
          : text;
    return { column, op, value: AppTable.valueAs(column, type, parsed, true) };
  }

  /** 정렬에 쓸 칸인가 (json은 정렬하지 않는다). 아니면 InvalidRequest */
  assertSortable(column: string): void {
    if (this.kindOf(column) === 'json')
      throw AppTable.invalid('order', 'json 칸으로는 정렬할 수 없어요');
  }

  private kindOf(column: string): string {
    if (column === 'id' || column === 'owner') return 'uuid';
    if (column === 'created_at' || column === 'updated_at') return 'time';
    const type = this.columns[column];
    if (type === undefined) throw AppTable.invalid(column, `표 ${this.row.name}에 없는 칸이에요`);
    return type;
  }

  private static invalid(field: string, message: string): InvalidRequest {
    return new InvalidRequest(new Map([[field, message]]));
  }

  /** 값 하나를 그 타입으로. filter면 조건의 값이라 NULL을 받지 않는다 */
  private static valueAs(where: string, type: string, value: unknown, filter = false): unknown {
    if (value === null && !filter) return null;
    const bad = (hint: string) => new RuleViolation(`${where}: ${hint}`);
    switch (type) {
      case 'text':
        if (typeof value !== 'string') throw bad('글자로 보내요');
        if (value.length > AppTable.TEXT_MAX) throw bad(`${AppTable.TEXT_MAX}자까지예요`);
        return value;
      case 'int':
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw bad('정수로 보내요');
        return value;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) throw bad('숫자로 보내요');
        return value;
      case 'bool':
        if (typeof value !== 'boolean') throw bad('true · false로 보내요');
        return value;
      case 'time': {
        const at = typeof value === 'string' ? new Date(value) : null;
        if (at === null || Number.isNaN(at.getTime())) throw bad('ISO 시각 글자로 보내요');
        return at;
      }
      case 'uuid':
        if (typeof value !== 'string' || !AppTable.UUID.test(value)) throw bad('id가 아니에요');
        return value;
      default:
        if (Buffer.byteLength(JSON.stringify(value) ?? '') > AppTable.JSON_BYTES_MAX)
          throw bad(`json 값은 ${AppTable.JSON_BYTES_MAX / 1024}KB까지예요`);
        return value;
    }
  }

  /** 이벤트로 온 선언 하나를 다시 본다 (blog가 검사한 값이지만 SQL의 이름이 되므로 여기서도 거른다) */
  private static specOf(
    name: string,
    spec: unknown,
  ): { columns: Record<string, string>; read: AppTableReadRule; write: AppTableWriteRule } {
    const { columns, read, write } = (spec ?? {}) as Record<string, unknown>;
    const listed = Object.entries((columns ?? {}) as Record<string, unknown>);
    const named = (text: string) => AppTable.NAME.test(text) && !AppTable.BUILT_IN.includes(text);
    if (!AppTable.NAME.test(name) || listed.length === 0)
      throw new RuleViolation(`표 선언이 틀렸어요: ${name}`);
    for (const [column, type] of listed)
      if (!named(column) || typeof type !== 'string' || !(type in AppTable.SQL_TYPES))
        throw new RuleViolation(`칸 선언이 틀렸어요: ${name}.${column}`);
    if (!['anyone', 'member', 'owner', 'admin'].includes(String(read)))
      throw new RuleViolation(`읽기 규칙이 틀렸어요: ${name}`);
    if (!['member', 'owner', 'admin'].includes(String(write)))
      throw new RuleViolation(`쓰기 규칙이 틀렸어요: ${name}`);
    return {
      columns: Object.fromEntries(listed) as Record<string, string>,
      read: read as AppTableReadRule,
      write: write as AppTableWriteRule,
    };
  }
}
