import { Database, type DomainEvent, Outbox, RuleViolation, TableRepository } from '../../platform';
import { apiConnectors } from '../task.schema';
import type { ApiConnectorRow } from '../task.tables';
import { ApiConnector } from './api-connector';

// task.api_connectors ↔ ApiConnector (2026-11-24). 불러오기 · 잠그기 · 저장은 기반이 한다.
export class ApiConnectorRepository extends TableRepository<ApiConnectorRow, ApiConnector> {
  protected readonly table = apiConnectors;
  protected readonly noun = 'API 커넥터';

  protected toEntity(row: ApiConnectorRow): ApiConnector {
    return ApiConnector.restore(row);
  }

  /** 같은 이름은 공간에 하나 (api_run이 부르는 이름이다) */
  override async save(connector: ApiConnector): Promise<void> {
    try {
      await super.save(connector);
    } catch (error) {
      if (Database.isUniqueViolation(error, 'api_connectors_space_id_name_key'))
        throw new RuleViolation('이미 쓰는 이름이에요');
      throw error;
    }
  }

  /** 이름으로 (잠가서). 없으면 null */
  async lockByName(spaceId: string, name: string): Promise<ApiConnector | null> {
    const [row] = await this.sql<ApiConnectorRow[]>`
      SELECT * FROM task.api_connectors WHERE space_id = ${spaceId} AND name = ${name} FOR UPDATE`;
    return row ? this.toEntity(row) : null;
  }

  /** 공간의 커넥터 전부 (이름 차례) */
  async all(spaceId: string): Promise<readonly ApiConnector[]> {
    return this.find({ space_id: spaceId }, { order: ['name'] });
  }

  /** 서버 키를 바꾼 뒤 다시 잠글 것 (키가 있는 커넥터 전부) */
  async lockSealed(): Promise<readonly ApiConnector[]> {
    const rows = await this.sql<ApiConnectorRow[]>`
      SELECT * FROM task.api_connectors WHERE secret IS NOT NULL ORDER BY id FOR UPDATE`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 마지막 사용 · 실패 까닭 (버전 없이: 관리자의 고치기와 겨루지 않게) */
  async noteUse(spaceId: string, id: string, error: string | null, at: Date): Promise<void> {
    await this.sql`
      UPDATE task.api_connectors SET last_used_at = ${at}, last_error = ${error === null ? null : error.slice(0, 300)}
      WHERE space_id = ${spaceId} AND id = ${id}`;
  }

  /** 커넥터 저장과 따로 내는 이벤트 (결재 결과: 커넥터가 없거나 바뀌지 않았어도 알려야 작업이 끝난다) */
  async announce(event: DomainEvent): Promise<void> {
    await new Outbox(this.sql).publish([event]);
  }

  /** 지운다 (부르기 기록도 함께, 외래키 CASCADE) */
  async remove(connector: ApiConnector): Promise<void> {
    await this
      .sql`DELETE FROM task.api_connectors WHERE space_id = ${connector.spaceId} AND id = ${connector.id}`;
  }
}
