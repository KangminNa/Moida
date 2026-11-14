import { type DomainEvent, Outbox, TableRepository } from '../../platform';
import { issues } from '../blog.schema';
import type { IssueRow } from '../blog.tables';
import { Issue } from './issue';

// blog.issues ↔ Issue. 불러오기 · 잠그기 · 저장(바뀐 칸만, version으로 늦은 쓰기를 막는다)은 기반이 한다.
export class IssueRepository extends TableRepository<IssueRow, Issue> {
  protected readonly table = issues;
  protected readonly noun = '호';

  protected toEntity(row: IssueRow): Issue {
    return Issue.restore(row);
  }

  /** 메뉴의 다음 호 번호 (메뉴를 잠근 뒤에 부른다) */
  async nextNumber(menuId: string): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      SELECT coalesce(max(number), 0)::int + 1 AS n FROM blog.issues WHERE menu_id = ${menuId}`;
    return row?.n ?? 1;
  }

  /** 호 저장과 따로 내는 이벤트 (결재 결과: 호가 없거나 바뀌지 않았어도 알려야 작업이 끝난다) */
  async announce(event: DomainEvent): Promise<void> {
    await new Outbox(this.sql).publish([event]);
  }

  /** 지운다 (발행 전의 호만. 글은 Service가 먼저 뺀다) */
  async remove(issue: Issue): Promise<void> {
    await this.deleteRows(issues, { id: issue.id });
  }
}
