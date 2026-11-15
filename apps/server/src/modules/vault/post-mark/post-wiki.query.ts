import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import type { WikiRow } from '../vault.tables';

// 글이 가리킬 wiki를 blog가 묻는 읽기. blog는 vault를 가져오지 않고 platform의 Lookups로 묻는다 ('wiki', 리팩토링 R3b).
// 볼 수 없는 wiki는 없는 wiki와 똑같다: 목록에서 빠지고, blog는 같은 NotFound로 답한다. 휴지통 wiki도 없는 wiki다.
@Injectable()
export class PostWikiQuery extends BaseQuery {
  /** ids 중 이 요청자가 볼 수 있는 wiki의 id → 제목 */
  async visible(actor: Actor, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.sql<Pick<WikiRow, 'node_id' | 'title'>[]>`
      SELECT w.node_id, w.title FROM vault.wikis w JOIN vault.nodes n ON n.id = w.node_id
      WHERE w.node_id = ANY(${ids as string[]}::uuid[]) AND n.deleted_at IS NULL
        ${actor.spaceId === null ? this.sql`` : this.sql`AND w.space_id = ${actor.spaceId}`}
        ${this.visibleTo(actor, 'w.visibility')}`;
    return new Map(rows.map((r) => [r.node_id, r.title]));
  }
}
