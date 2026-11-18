import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, NotFound } from '../../platform';
import { App } from '../app/app';
import type { IssueRow } from '../blog.tables';
import type { IssueNumberInput, ListIssuesInput } from './issue.input';
import {
  IssueDetailView,
  type IssueListRow,
  IssueListView,
  type IssuePostRow,
  PublicIssueListView,
  PublicIssueView,
} from './issue.view';

// 매거진 호 읽기 (2차 6단계). 관리자는 만드는 중인 호까지, 방문자는 발행한 호와 그 안의 공개 글만.
// 방문자는 공간을 모른다: MVP는 공간 하나라 방문자 읽기는 공간으로 거르지 않는다 (blog 규칙).
@Injectable()
export class IssueQuery extends BaseQuery {
  private static readonly MISSING = '호를 찾을 수 없어요';

  /** 앱 · 메뉴(주소)의 호, 새 번호부터. 방문자는 공개 앱의 발행한 호만 (스토어 1단계). 관리자는 메뉴 없이 모든 호도 */
  async list(actor: Actor, req: ListIssuesInput): Promise<IssueListView | PublicIssueListView> {
    const all = actor.kind === 'owner';
    const menu = req.menu === null ? this.sql`` : this.sql`AND m.slug = ${req.menu}`;
    const app = req.app === null ? this.sql`` : this.sql`AND a.slug = ${req.app}`;
    if (!all) {
      const rows = await this.sql<IssueRow[]>`
        SELECT i.* FROM blog.issues i JOIN blog.menus m ON m.id = i.menu_id
          JOIN blog.apps a ON a.id = m.app_id
        WHERE i.status = 'published' AND a.visibility = ${App.PUBLIC} ${app} ${menu}
        ORDER BY i.number DESC`;
      return new PublicIssueListView(rows);
    }
    const rows = await this.sql<IssueListRow[]>`
      SELECT i.*, (SELECT count(*)::int FROM blog.posts p WHERE p.issue_id = i.id) AS posts
      FROM blog.issues i JOIN blog.menus m ON m.id = i.menu_id JOIN blog.apps a ON a.id = m.app_id
      WHERE i.space_id = ${actor.requireSpace()} ${app} ${menu}
      ORDER BY a.sort, m.sort, i.number DESC`;
    return new IssueListView(rows);
  }

  /** 관리자의 호 하나와 든 글 (임시 글까지, 순서대로) */
  async detail(actor: Actor, id: string): Promise<IssueDetailView> {
    actor.assertOwner();
    const [row] = await this.sql<IssueRow[]>`
      SELECT * FROM blog.issues WHERE space_id = ${actor.requireSpace()} AND id = ${id}`;
    if (!row) throw new NotFound(IssueQuery.MISSING);
    return new IssueDetailView(row, await this.postsOf(row.id, false));
  }

  /** 방문자가 여는 호 하나 (/<앱>/m/<메뉴>/<번호>): 공개 앱의 발행한 호만, 글은 공개 글만 */
  async byNumber(actor: Actor, req: IssueNumberInput): Promise<PublicIssueView> {
    const [row] = await this.sql<IssueRow[]>`
      SELECT i.* FROM blog.issues i JOIN blog.menus m ON m.id = i.menu_id
        JOIN blog.apps a ON a.id = m.app_id
      WHERE a.slug = ${req.app} AND m.slug = ${req.menu} AND i.number = ${req.number}
        ${actor.kind === 'owner' ? this.sql`AND a.space_id = ${actor.requireSpace()}` : this.sql`AND i.status = 'published' AND a.visibility = ${App.PUBLIC}`}`;
    if (!row) throw new NotFound(IssueQuery.MISSING);
    return new PublicIssueView(row, await this.postsOf(row.id, true));
  }

  /** 결재한 호 발행 전에 빠진 점 (platform ActionChecks): 글이 없는 호. 없는 호면 null (발행이 실패로 알린다) */
  async publishProblem(actor: Actor, issueId: string): Promise<string | null> {
    actor.assertOwnerOrSystem();
    const [row] = await this.sql<{ title: string; posts: number }[]>`
      SELECT i.title, (SELECT count(*)::int FROM blog.posts p
                       WHERE p.issue_id = i.id AND p.deleted_at IS NULL) AS posts
      FROM blog.issues i WHERE i.id = ${issueId}`;
    return row && row.posts === 0 ? `글이 없는 호: ${row.title}` : null;
  }

  private postsOf(issueId: string, publicOnly: boolean) {
    return this.sql<IssuePostRow[]>`
      SELECT id, slug, title, excerpt, status, issue_order FROM blog.posts
      WHERE issue_id = ${issueId} AND deleted_at IS NULL
        ${publicOnly ? this.sql`AND status = 'published'` : this.sql``}
      ORDER BY issue_order, id`;
  }
}
