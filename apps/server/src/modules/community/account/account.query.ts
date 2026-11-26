import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database } from '../../platform';
import type { AccountRow } from '../community.tables';
import { AdminPageView } from '../moderation/moderation.view';
import type { AccountListInput } from './account.input';
import { AccountAdminView } from './account.view';

// 스토어 계정 관리 읽기 (2026-11-26, 설정 › 회원 계정): 관리자만, 자기 공간의 계정 (최근 가입부터, 탈퇴한 계정 포함). apps: 참여 중인 앱 수
@Injectable()
export class AccountQuery extends BaseQuery {
  static readonly PAGE = 50;

  constructor(db: Database) {
    super(db);
  }

  async list(actor: Actor, req: AccountListInput): Promise<AdminPageView<AccountAdminView>> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const after = req.cursor === null ? this.sql`` : this.sql`AND a.id < ${req.cursor}`;
    const rows = await this.sql<
      (Pick<
        AccountRow,
        | 'id'
        | 'login_id'
        | 'email'
        | 'joined_at'
        | 'last_seen_at'
        | 'suspended_until'
        | 'left_at'
        | 'version'
      > & { apps: number })[]
    >`
      SELECT a.id, a.login_id, a.email, a.joined_at, a.last_seen_at, a.suspended_until, a.left_at, a.version,
        (SELECT count(*) FROM community.members m WHERE m.account_id = a.id) AS apps
      FROM community.accounts a
      WHERE a.space_id = ${spaceId} ${after}
      ORDER BY a.id DESC LIMIT ${AccountQuery.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, AccountQuery.PAGE, (last) => last.id);
    return new AdminPageView(
      items.map((r) => new AccountAdminView(r)),
      next,
    );
  }
}
