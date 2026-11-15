import { BaseRepository } from '../base/base-repository';
import { Outbox } from '../base/outbox';
import { Rule } from '../base/table-query';
import { outbox } from '../platform.schema';
import type { OutboxRow } from '../platform.tables';
import { FailedEvent } from './failed-event';

// platform.outbox의 멈춘 줄 ↔ FailedEvent. 열쇠가 정수 번호이고 version 칸이 없어 TableRepository를 쓰지 않는다.
// 공간 조건: 관리자는 자기 공간, 명령줄(SystemActor)은 공간 없이 모두 (null).
export class FailedEventRepository extends BaseRepository<FailedEvent> {
  private static readonly ALL_MAX = 500;

  protected toEntity(row: OutboxRow): FailedEvent {
    return FailedEvent.restore(row);
  }

  /** 트랜잭션 안에서 이벤트 하나를 잠그고 읽는다. 없으면 NotFound (멈췄는지는 엔티티가 본다) */
  async lock(id: number, spaceId: string | null): Promise<FailedEvent> {
    const rows = await this.rows(
      outbox,
      { id, space_id: Rule.maybe(spaceId) },
      { lock: true, limit: 1 },
    );
    return this.one(rows, '처리');
  }

  /** 멈춘 이벤트를 모두 잠그고 읽는다 (오래된 것부터, 500개까지) */
  async lockFailed(spaceId: string | null): Promise<readonly FailedEvent[]> {
    const rows = await this.rows(
      outbox,
      { space_id: Rule.maybe(spaceId), failed_at: Rule.set },
      { order: ['id'], lock: true, limit: FailedEventRepository.ALL_MAX },
    );
    return rows.map((r) => this.toEntity(r));
  }

  /** 공간에 아직 멈춘 이벤트가 있는가 */
  anyFailed(spaceId: string): Promise<boolean> {
    return this.exists(outbox, { space_id: spaceId, failed_at: Rule.set });
  }

  /** 다시 시도하게 돌린 칸을 적고 일꾼을 깨운다 (커밋될 때 전달) */
  async save(event: FailedEvent): Promise<void> {
    const changes = event.unsaved;
    if (!changes) return;
    await this.updateRows(outbox, changes, { id: Number(event.id) });
    await new Outbox(this.sql).poke();
  }
}
