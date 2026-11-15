import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, SettingActor } from '../../platform';
import { tidySettings } from '../vault.schema';
import { TidySettingsView, TidySettingView } from './tidy.view';
import type { TidySessionRow } from './tidy-settings';

// 세션 정리 읽기: 설정(주인), 정리를 맡길 세션. 자동 정리는 일꾼이 SystemActor로 읽는다.
@Injectable()
export class TidyQuery extends BaseQuery {
  /** 한 번에 맡기는 세션 수. 주인의 구독 토큰을 쓰므로 조금씩 */
  private static readonly BACKLOG_BATCH = 20;
  /** 하루 한 번에 맡기는 세션 수 (남은 것은 다음 날) */
  private static readonly DAILY_BATCH = 50;

  /** 공간의 정리 설정 (공간마다 한 줄, 없으면 꺼짐) */
  async settings(actor: Actor): Promise<TidySettingsView> {
    actor.assertOwner();
    const row = await this.row(
      tidySettings,
      { space_id: actor.requireSpace() },
      { columns: ['auto_tidy', 'cadence', 'daily_at', 'version'] },
    );
    return new TidySettingsView(row ?? { auto_tidy: false, version: 0 });
  }

  /** 대화로 바꾸는 설정의 지금 값 (2026-11-15 D, get_settings tidy). 확인을 거친 제안자만 */
  async setting(actor: Actor): Promise<TidySettingView> {
    const row = await this.row(
      tidySettings,
      { space_id: SettingActor.spaceOf(actor) },
      { columns: ['auto_tidy', 'cadence', 'version'] },
    );
    return new TidySettingView(row ?? { auto_tidy: false, version: 0 });
  }

  /** 하루 한 번의 차례가 된 공간 (일꾼, 2차 7단계): 자동 정리가 켜졌고 하루 한 번이고 지난 차례에서 하루가 지났다 */
  async dailySpaces(actor: Actor): Promise<readonly string[]> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql<{ space_id: string }[]>`
      SELECT space_id FROM vault.tidy_settings
      WHERE auto_tidy AND cadence = 'daily'
        AND (daily_at IS NULL OR daily_at < now() - interval '23 hours')
      ORDER BY space_id`;
    return rows.map((r) => r.space_id);
  }

  /** 하루 한 번에 맡길 세션: 지난 요청 뒤로 새 판이 쌓인 세션 (대표 wiki가 있어도). 오래된 순으로 한 묶음 */
  async daily(actor: Actor, spaceId: string): Promise<readonly TidySessionRow[]> {
    actor.assertCan(Actor.TIDY);
    return this.sql<TidySessionRow[]>`
      SELECT s.node_id, s.head_title, s.revision_count, s.version
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${spaceId} AND n.deleted_at IS NULL
        AND s.tidy_requested_seq < s.revision_count
      ORDER BY s.node_id
      LIMIT ${TidyQuery.DAILY_BATCH}`;
  }

  /** 저장된 세션 하나. 그사이 지웠으면 null */
  async session(actor: Actor, spaceId: string, id: string): Promise<TidySessionRow | null> {
    actor.assertCan(Actor.TIDY);
    const [row] = await this.sql<TidySessionRow[]>`
      SELECT s.node_id, s.head_title, s.revision_count, s.version
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.node_id = ${id} AND s.space_id = ${spaceId} AND n.deleted_at IS NULL`;
    return row ?? null;
  }

  /** 이번에 맡길 세션. 오래된 순(UUIDv7)으로 한 묶음 */
  async backlog(actor: Actor): Promise<readonly TidySessionRow[]> {
    actor.assertOwner();
    return this.sql<TidySessionRow[]>`
      SELECT s.node_id, s.head_title, s.revision_count, s.version
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE ${this.waiting(actor)}
      ORDER BY s.node_id
      LIMIT ${TidyQuery.BACKLOG_BATCH}`;
  }

  /** 아직 맡기지 않은 세션 수 */
  async remaining(actor: Actor): Promise<number> {
    actor.assertOwner();
    const [row] = await this.sql<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE ${this.waiting(actor)}`;
    return row?.total ?? 0;
  }

  /** 대표 wiki가 없고, 지금 판의 정리를 아직 요청하지 않은 세션. 요청한 뒤에 실패한 세션은 새 판이 쌓여야 돌아온다 */
  private waiting(actor: Actor) {
    return this.sql`s.space_id = ${actor.spaceId} AND s.wiki_id IS NULL AND n.deleted_at IS NULL
      AND s.tidy_requested_seq < s.revision_count`;
  }
}
