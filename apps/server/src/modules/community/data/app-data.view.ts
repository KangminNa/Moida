import type { AppTableRow } from '../community.tables';

// 앱 데이터의 응답 (스토어 12.4). 줄의 칸은 앱이 선언한 것이라 이름 → 값 그대로 싣는다.
// 회원 쪽에는 쓴 회원의 id를 싣지 않고 내 줄인지(mine)만 알린다 (id에는 가입한 때가 들어 있다). 관리자에게는 owner까지

/** 표에서 읽은 줄 하나: 붙인 칸(id · owner · created_at · updated_at)과 선언한 칸 */
export type AppDataRow = Readonly<Record<string, unknown>>;

function shown(row: AppDataRow, memberId: string | null, admin: boolean) {
  const { owner, ...rest } = row;
  return {
    ...rest,
    ...(admin ? { owner: owner ?? null } : {}),
    mine: memberId !== null && owner === memberId,
  };
}

/** 줄 하나 (만들거나 고친 결과) */
export class AppRowView {
  constructor(
    private readonly row: AppDataRow,
    private readonly memberId: string | null,
    private readonly admin = false,
  ) {}

  toJSON() {
    return shown(this.row, this.memberId, this.admin);
  }
}

/** 줄 목록. more: 뒤에 줄이 더 있다 (offset을 limit만큼 올려 읽는다) */
export class AppRowsView {
  constructor(
    private readonly rows: readonly AppDataRow[],
    private readonly more: boolean,
    private readonly memberId: string | null,
    private readonly admin = false,
  ) {}

  toJSON() {
    return {
      rows: this.rows.map((row) => shown(row, this.memberId, this.admin)),
      more: this.more,
    };
  }
}

/** 관리자의 표 목록: 선언 · 열려 있는지 · 줄 수 (한도까지만 센다) */
export class AppTablesView {
  constructor(private readonly tables: readonly (Readonly<AppTableRow> & { rows: number })[]) {}

  toJSON() {
    return {
      tables: this.tables.map((t) => ({
        name: t.name,
        columns: t.columns as Record<string, string>,
        read: t.read_rule,
        write: t.write_rule,
        open: t.open,
        appliedSeq: t.applied_seq,
        rows: t.rows,
      })),
    };
  }
}

/** 대화의 get_settings app_data: 줄을 넣을 수 있는 표 (공간의 열린 표) */
export class AppDataSettingsView {
  constructor(private readonly tables: readonly Readonly<AppTableRow>[]) {}

  toJSON() {
    return {
      app_data: this.tables.map((t) => ({
        app_id: t.app_id,
        table: t.name,
        columns: t.columns as Record<string, string>,
        read: t.read_rule,
        write: t.write_rule,
      })),
    };
  }
}

/** 넣은 줄 수 (관리자 · 승인받은 일꾼의 넣기) */
export class AppRowsAddedView {
  constructor(
    private readonly table: string,
    private readonly added: number,
  ) {}

  toJSON() {
    return { table: this.table, added: this.added };
  }
}
