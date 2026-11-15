import { Injectable } from '@nestjs/common';
import type { LibraryInput } from '../library/library.input';
import type { Actor } from './actor';
import { Database, type Sql } from './database';
import { TableReader } from './table-query';

// 읽기(R)의 기반. 화면·AI가 함께 보는 묶음(View)을 바로 만든다. 쓰지 않는다.
// 표 하나의 읽기는 코어의 조건 규칙(this.rows · row · exists), 표를 잇거나 모으는 그 기능만의 읽기는 this.sql.
// 공개 메서드는 모두 첫 인자로 Actor를 받고, 공개 범위를 SQL에서 거른 뒤 개수·순위를 계산한다.
@Injectable()
export abstract class BaseQuery extends TableReader {
  constructor(protected readonly db: Database) {
    super();
  }

  protected get sql(): Sql {
    return this.db.sql;
  }

  /**
   * 공개 범위 조건. 비공개를 볼 수 없는 요청자에게는 `AND <열> = 'public'`을 붙인다.
   * 사용: sql`SELECT … WHERE space_id = ${id} ${this.visibleTo(actor, 's.visibility')}`
   */
  protected visibleTo(actor: Actor, column = 'visibility') {
    return actor.canSeePrivate() ? this.sql`` : this.sql`AND ${this.sql(column)} = 'public'`;
  }

  /**
   * 보관함 읽기(2차 5단계)의 기간 · 커서 조건. 시각 · id · 제목 칸 이름을 받아 `AND …` 조각을 돌려준다.
   * 대화의 참조(2026-11-15 B)를 위해 id 목록(ids)과 제목 찾기(q, 대소문자 무시)도 받는다.
   * 읽기는 `ORDER BY <시각> DESC, <id> DESC LIMIT LibraryInput.PAGE + 1`로 쓴다 (LibraryQuery가 모아 자른다)
   */
  protected libraryWindow(at: string, id: string, title: string, filter: LibraryInput) {
    const sql = this.sql;
    const { from, to, before, ids, q } = filter;
    return sql`${from ? sql`AND ${sql(at)} >= ${from}` : sql``}
      ${to ? sql`AND ${sql(at)} <= ${to}` : sql``}
      ${before ? sql`AND (${sql(at)}, ${sql(id)}) < (${before[0]}, ${before[1]})` : sql``}
      ${ids ? sql`AND ${sql(id)} = ANY(${ids as string[]}::uuid[])` : sql``}
      ${q ? sql`AND strpos(lower(${sql(title)}), lower(${q})) > 0` : sql``}`;
  }
}
