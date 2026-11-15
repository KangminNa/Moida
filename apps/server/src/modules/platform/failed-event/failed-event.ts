import { BaseEntity } from '../base/base-entity';
import { Conflict } from '../base/errors';
import { NoticeKind } from '../notice/notice-kind';
import type { NoticeNew } from '../notice/notices';
import type { OutboxNew, OutboxRow } from '../platform.tables';
import { FailedEventView } from './failed-event.view';

// 8번 실패해 멈춘 이벤트 하나 (리팩토링 R1, 2026-11-16). outbox 줄을 든다.
// 일꾼이 멈출 때 관리자에게 알리고(notice), 관리자가 화면 · 명령줄에서 다시 시도한다(retry).
// 다시 시도는 시도 횟수를 0으로 돌려 처음 온 이벤트처럼 다룬다: 받는 쪽은 두 번 불려도 결과가 같아야 한다는 규칙이 있어,
// 앞에서 성공한 받는 쪽이 다시 불려도 된다. 실패를 저절로 작업 실패로 바꾸지 않는다 (다시 시도해서 성공하면 어긋난다).
// version 칸이 없는 표라 BaseEntity로 든다 (PluginState처럼). 줄을 지우지 않는다.
export class FailedEvent extends BaseEntity {
  /** 알림 종류 (설정 › 알림에 보인다) */
  static readonly NOTICE = 'platform.event.failed';
  /** 안 읽은 알림 하나만 새 내용으로 바꾼다: 여럿이 한꺼번에 멈춰도 알림이 쌓이지 않게 */
  static readonly NOTICE_GROUP = 'event-failed';
  private static readonly LINK = '/admin/events';
  private static readonly TITLE_MAX = 200;
  private static readonly ERROR_MAX = 300;

  private retried: Pick<OutboxNew, 'attempts' | 'failed_at' | 'next_attempt_at'> | null = null;

  private constructor(private readonly row: Readonly<OutboxRow>) {
    super(String(row.id), 1);
  }

  static restore(row: OutboxRow): FailedEvent {
    return new FailedEvent(row);
  }

  /** 일꾼이 이벤트를 멈출 때 같은 트랜잭션에서 남기는 알림 */
  static notice(spaceId: string, eventId: number, topic: string, error: string): NoticeNew {
    return {
      space_id: spaceId,
      kind: FailedEvent.NOTICE,
      severity: NoticeKind.IMMEDIATE,
      title: `처리 실패: ${topic}`.slice(0, FailedEvent.TITLE_MAX),
      body: error.slice(0, FailedEvent.ERROR_MAX),
      link: FailedEvent.LINK,
      group_key: FailedEvent.NOTICE_GROUP,
      data: { eventId, topic },
    };
  }

  /** 다시 시도: 멈춘 이벤트만. 일꾼이 다음 바퀴에 처음처럼 받는 쪽에 넘긴다 (마지막 오류는 성공할 때 지운다) */
  retry(now: Date): void {
    if (this.row.failed_at === null)
      throw new Conflict('멈춘 처리가 아니에요. 목록을 새로 불러와 주세요');
    this.retried = { attempts: 0, failed_at: null, next_attempt_at: now };
  }

  /** 저장할 칸 (다시 시도했을 때만). Repository가 부른다 */
  get unsaved(): Readonly<Pick<OutboxNew, 'attempts' | 'failed_at' | 'next_attempt_at'>> | null {
    return this.retried;
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  view(): FailedEventView {
    return new FailedEventView({ ...this.row, ...(this.retried ?? {}) });
  }
}
