import { BaseEntity, type Row, TableRepository } from '../../platform';
import { appTables } from '../community.schema';
import type { AppTableRow } from '../community.tables';
import { type AppDataFilter, AppTable } from './app-table';

// community.app_tables ↔ AppTable, 그리고 앱마다의 스키마(app_<앱 id>)에 있는 실제 표의 SQL (스토어 12.4).
// load · lock의 첫 값은 앱 id다. 이름은 모두 선언 목록(AppTable)에서 온 것만 SQL에 쓴다: 요청의 글자는 값(매개변수)으로만 간다.
// 줄에는 엔티티가 없다 (칸을 앱이 정한다): 값은 AppTable.checked가 타입에 맞춘 것만 받는다.
// 회원 쪽 쿼리는 asMember 뒤에 한다: 그 트랜잭션은 역할 cairn_app으로 돌아 행 수준 보안(ensure가 건 정책)이 걸린다.
export class AppTableRepository extends TableRepository<AppTableRow, AppTable> {
  protected readonly table = appTables;
  protected readonly noun = '표';
  private static readonly ROLE = 'cairn_app';
  /** 지금 회원 (없으면 NULL): asMember가 정한 값 */
  private static readonly ME = `nullif(current_setting('cairn.member', true), '')`;

  protected toEntity(row: AppTableRow): AppTable {
    return AppTable.restore(row);
  }

  protected override select(appId: string, id: string, lock: boolean): Promise<readonly Row[]> {
    return this.rows(appTables, { id, app_id: appId }, { lock });
  }

  /** 앱의 표 전부 (닫힌 것까지). lock이면 맞추는 동안 잠근다 */
  listOf(appId: string, lock = false): Promise<AppTable[]> {
    return this.find({ app_id: appId }, { order: ['name'], lock });
  }

  /** 이 앱의 표를 맞추는 동안 다른 맞추기를 기다리게 한다 (표가 아직 없는 앱도 잠근다) */
  async lockApp(appId: string): Promise<void> {
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`app-tables:${appId}`}, 0))`;
  }

  /** 앱의 열려 있는 표 하나. 없거나 닫혔으면 null */
  async openOf(appId: string, name: string): Promise<AppTable | null> {
    return this.findOne({ app_id: appId, name, open: true });
  }

  /**
   * 실제 표를 선언에 맞춘다: 없는 스키마 · 표 · 칸을 더하고 정책을 다시 건다. 지우는 DDL은 없다.
   * 이름은 AppTable이 거른 것(영문 소문자 · 숫자 · _)이고 타입은 정해진 목록의 글자다
   */
  async ensure(table: AppTable): Promise<void> {
    const schema = AppTable.schemaOf(table.appId);
    const at = `"${schema}"."${table.name}"`;
    const role = AppTableRepository.ROLE;
    const run = (text: string) => this.sql.unsafe(text);
    await run(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await run(`GRANT USAGE ON SCHEMA "${schema}" TO ${role}`);
    await run(`CREATE TABLE IF NOT EXISTS ${at} (
      id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
      owner uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now())`);
    for (const [column, type] of Object.entries(table.columns))
      await run(
        `ALTER TABLE ${at} ADD COLUMN IF NOT EXISTS "${column}" ${AppTable.SQL_TYPES[type]}`,
      );
    await run(`CREATE INDEX IF NOT EXISTS "${table.name}_owner" ON ${at} (owner, id DESC)`);
    await run(`ALTER TABLE ${at} ENABLE ROW LEVEL SECURITY`);
    await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${at} TO ${role}`);
    const me = AppTableRepository.ME;
    const mine = `owner::text = ${me}`;
    const reads = { anyone: 'true', member: `${me} IS NOT NULL`, owner: mine, admin: 'false' };
    const inserts = table.writeRule === 'admin' ? 'false' : `${me} IS NOT NULL AND ${mine}`;
    const edits = table.writeRule === 'owner' ? mine : 'false';
    for (const name of ['cairn_read', 'cairn_insert', 'cairn_update', 'cairn_delete'])
      await run(`DROP POLICY IF EXISTS ${name} ON ${at}`);
    await run(
      `CREATE POLICY cairn_read ON ${at} FOR SELECT TO ${role} USING (${reads[table.readRule]})`,
    );
    await run(`CREATE POLICY cairn_insert ON ${at} FOR INSERT TO ${role} WITH CHECK (${inserts})`);
    await run(
      `CREATE POLICY cairn_update ON ${at} FOR UPDATE TO ${role} USING (${edits}) WITH CHECK (${edits})`,
    );
    await run(`CREATE POLICY cairn_delete ON ${at} FOR DELETE TO ${role} USING (${edits})`);
  }

  /**
   * 이 트랜잭션의 남은 쿼리를 회원 쪽 역할로 돌린다 (행 수준 보안이 걸린다). memberId가 null이면 로그인하지 않은 방문자.
   * 이 뒤에는 community의 다른 표를 읽지 못하므로 회원 행 확인은 이 앞에서 한다. 쿼리는 5초까지
   */
  async asMember(memberId: string | null): Promise<void> {
    await this.sql`SELECT set_config('cairn.member', ${memberId ?? ''}, true)`;
    await this.sql.unsafe(`SET LOCAL statement_timeout = 5000`);
    await this.sql.unsafe(`SET LOCAL ROLE ${AppTableRepository.ROLE}`);
  }

  /** 줄 읽기: 조건(AND) · 정렬 · 개수. 한 개 더 읽어 뒤가 있는지 알린다 (부르는 쪽이 자른다) */
  readRows(
    table: AppTable,
    filters: readonly AppDataFilter[],
    order: readonly [string, boolean],
    limit: number,
    offset: number,
  ): Promise<readonly Row[]> {
    const sql = this.sql;
    const where = filters.reduce(
      (all, f) =>
        sql`${all} AND ${sql(f.column)} ${sql.unsafe(AppTable.OPS[f.op] ?? '=')} ${f.value as string}`,
      sql`true`,
    );
    const [column, ascending] = order;
    return sql`
      SELECT ${sql(table.columnNames as string[])}
      FROM ${this.at(table)} WHERE ${where}
      ORDER BY ${sql(column)} ${ascending ? sql`ASC` : sql`DESC`} NULLS LAST, id DESC
      LIMIT ${limit + 1} OFFSET ${offset}`;
  }

  /** 줄 하나 (정책이 보여 주는 줄만). 없으면 null */
  async readRow(table: AppTable, id: string): Promise<Row | null> {
    const [row] = await this.sql`
      SELECT ${this.sql(table.columnNames as string[])} FROM ${this.at(table)} WHERE id = ${id}`;
    return row ?? null;
  }

  /** 줄 수: 표 전체(한도까지만 센다) · 그 회원의 것 */
  async countRows(table: AppTable, ownerId: string | null): Promise<readonly [number, number]> {
    const cap = AppTable.ROWS_MAX + 1;
    const [all] = await this.sql<{ n: string }[]>`
      SELECT count(*) AS n FROM (SELECT 1 FROM ${this.at(table)} LIMIT ${cap}) t`;
    if (ownerId === null) return [Number(all?.n ?? 0), 0];
    const [own] = await this.sql<{ n: string }[]>`
      SELECT count(*) AS n FROM ${this.at(table)} WHERE owner = ${ownerId}`;
    return [Number(all?.n ?? 0), Number(own?.n ?? 0)];
  }

  /** 줄 하나 넣기. id는 서버가 만든다 (역할 cairn_app은 기본값 함수를 부르지 못한다). 넣은 줄을 돌려준다 */
  async insertRow(
    table: AppTable,
    ownerId: string | null,
    values: Readonly<Record<string, unknown>>,
    now: Date,
  ): Promise<Row> {
    const row = {
      ...values,
      id: BaseEntity.newId(),
      owner: ownerId,
      created_at: now,
      updated_at: now,
    };
    await this
      .sql`INSERT INTO ${this.at(table)} ${this.sql(row as unknown as Record<string, string>)}`;
    return Object.fromEntries(table.columnNames.map((c) => [c, (row as Row)[c] ?? null])) as Row;
  }

  /** 줄 하나 고치기. 바뀐 줄 수 (정책이 막았거나 없으면 0) */
  async updateRow(
    table: AppTable,
    id: string,
    values: Readonly<Record<string, unknown>>,
    now: Date,
  ): Promise<number> {
    const set = { ...values, updated_at: now };
    const done = await this.sql`
      UPDATE ${this.at(table)} SET ${this.sql(set as unknown as Record<string, string>)} WHERE id = ${id}`;
    return done.count;
  }

  /** 줄 하나 지우기. 지운 줄 수 */
  async deleteRow(table: AppTable, id: string): Promise<number> {
    const done = await this.sql`DELETE FROM ${this.at(table)} WHERE id = ${id}`;
    return done.count;
  }

  /** 앱의 표를 모두 지운다: 앱 스키마(표 · 줄째)와 표 목록. 지운 앱에만 (AppDataService.dropApp) */
  async dropApp(appId: string): Promise<void> {
    await this.sql.unsafe(`DROP SCHEMA IF EXISTS "${AppTable.schemaOf(appId)}" CASCADE`);
    await this.deleteRows(appTables, { app_id: appId });
  }

  /** 내보내기 (스토어 12.5): 표의 줄을 INSERT 문으로 (값은 Postgres가 적는다). 붙인 칸까지 싣는다 */
  async dumpRows(table: AppTable): Promise<readonly string[]> {
    const names = table.columnNames.map((c) => `"${c}"`).join(', ');
    const values = table.columnNames
      .map((c) => `quote_nullable("${c}"::text)`)
      .join(` || ', ' || `);
    const target = `"${table.name}" (${names})`;
    const rows = await this.sql.unsafe<{ line: string }[]>(
      `SELECT 'INSERT INTO ${target} VALUES (' || ${values} || ');' AS line
       FROM "${AppTable.schemaOf(table.appId)}"."${table.name}" ORDER BY id`,
    );
    return rows.map((r) => r.line);
  }

  private at(table: AppTable) {
    return this.sql`${this.sql(AppTable.schemaOf(table.appId))}.${this.sql(table.name)}`;
  }
}
