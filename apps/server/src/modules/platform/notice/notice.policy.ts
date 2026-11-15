import type { NotificationRow } from '../platform.tables';
import { NoticeKind } from './notice-kind';
import type { NoticeSettings } from './notice-settings';

/** 푸시를 정할 알림 한 줄 */
export type PendingNotice = Pick<
  NotificationRow,
  'id' | 'kind' | 'severity' | 'title' | 'body' | 'link' | 'created_at'
>;

/** 브라우저로 보낼 푸시 하나. 서비스 워커가 받는 내용과, 이 푸시로 다룬 알림 */
export class PushMessage {
  constructor(
    readonly title: string,
    readonly body: string,
    /** 누르면 열 콘솔 주소 */
    readonly link: string,
    /** 같은 tag의 알림은 브라우저가 하나로 바꾼다 */
    readonly tag: string,
  ) {}

  /** 서비스 워커(sw.js)가 읽는 내용 */
  payload(): Buffer {
    return Buffer.from(
      JSON.stringify({ title: this.title, body: this.body, link: this.link, tag: this.tag }),
    );
  }
}

/** 이번 차례에 할 일: 보낼 푸시와 다룬 알림(보냈거나 보내지 않기로 한 것) */
export class PushPlan {
  constructor(
    readonly messages: readonly PushMessage[],
    readonly handled: readonly string[],
  ) {}

  get empty(): boolean {
    return this.messages.length === 0 && this.handled.length === 0;
  }
}

// 알림을 언제 푸시로 보낼지 (7단계). 입력 → 판단만 하고 DB · 바깥에 닿지 않는다.
//   경로가 push가 아니거나 기록만 등급이면 보내지 않고 다룬 것으로 (알림 센터에는 남아 있다)
//   하루가 지난 알림은 보내지 않는다 (서버가 오래 꺼져 있다 켜졌을 때 몰아서 울리지 않게)
//   조용한 시간에는 아무것도 보내지 않고 미룬다. 끝나면 다음 차례에 보낸다
//   즉시: 바로. 세 개가 넘게 쌓였으면(조용한 시간 뒤) 하나로 묶는다
//   묶음: 가장 오래된 것 뒤로 묶음 시각(매시 정각 · 하루 한 번)이 지났으면 하나로 묶어서
export class NoticePolicy {
  private static readonly MINUTE_MS = 60_000;
  private static readonly DAY_MS = 24 * 60 * 60_000;
  /** 즉시 알림을 하나씩 보내는 수. 넘으면 하나로 묶는다 */
  private static readonly SINGLE_MAX = 3;
  private static readonly BODY_MAX = 300;

  decide(
    pending: readonly PendingNotice[],
    settings: NoticeSettings,
    kinds: readonly NoticeKind[],
    now: Date,
  ): PushPlan {
    const byKind = new Map(kinds.map((k) => [k.kind, k]));
    const handled: string[] = [];
    const immediate: PendingNotice[] = [];
    const digest: PendingNotice[] = [];
    for (const notice of pending) {
      const kind =
        byKind.get(notice.kind) ?? new NoticeKind(notice.kind, notice.kind, notice.severity);
      const pushes = settings.routeOf(kind) === 'push' && notice.severity !== NoticeKind.LOG;
      const stale = now.getTime() - notice.created_at.getTime() > NoticePolicy.DAY_MS;
      if (!pushes || stale) handled.push(notice.id);
      else if (notice.severity === NoticeKind.DIGEST) digest.push(notice);
      else immediate.push(notice);
    }
    if (this.quiet(settings, now)) return new PushPlan([], handled);
    const messages: PushMessage[] = [];
    if (immediate.length > NoticePolicy.SINGLE_MAX) messages.push(NoticePolicy.bundle(immediate));
    else messages.push(...immediate.map((n) => NoticePolicy.single(n)));
    handled.push(...immediate.map((n) => n.id));
    const oldest = digest.reduce<Date | null>(
      (min, n) => (min === null || n.created_at < min ? n.created_at : min),
      null,
    );
    if (oldest !== null && this.lastDigestSlot(settings, now) > oldest) {
      messages.push(
        digest.length === 1
          ? NoticePolicy.single(digest[0] as PendingNotice)
          : NoticePolicy.bundle(digest),
      );
      handled.push(...digest.map((n) => n.id));
    }
    return new PushPlan(messages, handled);
  }

  /** 지금이 조용한 시간인가 (시간대 기준, 자정을 넘는 범위도) */
  quiet(settings: NoticeSettings, now: Date): boolean {
    const start = settings.quietStart;
    const end = settings.quietEnd;
    if (start === null || end === null) return false;
    const minute = NoticePolicy.minuteOfDay(now, settings.timeZone);
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }

  /** now 이전의 마지막 묶음 시각: 매시 정각, 또는 하루 한 번 정한 시각 (시간대 기준) */
  lastDigestSlot(settings: NoticeSettings, now: Date): Date {
    const minute = NoticePolicy.minuteOfDay(now, settings.timeZone);
    const back = settings.daily ? (minute - settings.digestMinute + 1440) % 1440 : minute % 60;
    const floor = Math.floor(now.getTime() / NoticePolicy.MINUTE_MS) * NoticePolicy.MINUTE_MS;
    return new Date(floor - back * NoticePolicy.MINUTE_MS);
  }

  private static single(notice: PendingNotice): PushMessage {
    return new PushMessage(
      notice.title,
      (notice.body ?? '').slice(0, NoticePolicy.BODY_MAX),
      notice.link ?? '/admin',
      notice.id,
    );
  }

  /** 여러 알림을 하나로: 제목은 수, 본문은 앞의 제목들 */
  private static bundle(notices: readonly PendingNotice[]): PushMessage {
    return new PushMessage(
      `알림 ${notices.length}개`,
      notices
        .map((n) => n.title)
        .join(' · ')
        .slice(0, NoticePolicy.BODY_MAX),
      '/admin',
      'bundle',
    );
  }

  /**
   * 이번 차례에 다루지 않고 남은 알림을 다시 볼 때 (일꾼의 다음 마감, 리팩토링 2단계). 남은 것이 없으면 null.
   * 조용한 시간이면 끝나는 때, 아니면 다음 묶음 시각 (남은 것은 아직 때가 안 된 묶음뿐이다).
   * 시간대의 분으로 세므로 서머타임 경계에서는 이르게 깰 수 있다: 그때 다시 재면 된다
   */
  nextAt(remaining: number, settings: NoticeSettings, now: Date): Date | null {
    if (remaining === 0) return null;
    const { quietEnd, timeZone } = settings;
    if (this.quiet(settings, now) && quietEnd !== null)
      return NoticePolicy.nextMinuteOfDay(quietEnd, timeZone, now);
    if (settings.daily) return NoticePolicy.nextMinuteOfDay(settings.digestMinute, timeZone, now);
    const minute = NoticePolicy.minuteOfDay(now, timeZone);
    return NoticePolicy.afterMinutes(now, 60 - (minute % 60));
  }

  /** now 뒤로 처음 오는, 시간대에서 하루 중 target분인 때 (지금이 그 분이면 다음 날) */
  private static nextMinuteOfDay(target: number, timeZone: string, now: Date): Date {
    const minute = NoticePolicy.minuteOfDay(now, timeZone);
    const at = NoticePolicy.afterMinutes(now, (target - minute + 1440) % 1440 || 1440);
    // 서머타임으로 그날의 길이가 다르면 한 번 맞춘다 (한 시간 안의 차이)
    const off = (target - NoticePolicy.minuteOfDay(at, timeZone) + 1440) % 1440;
    return off === 0
      ? at
      : new Date(at.getTime() + (off > 720 ? off - 1440 : off) * NoticePolicy.MINUTE_MS);
  }

  /** now가 든 분의 시작에서 n분 뒤 */
  private static afterMinutes(now: Date, n: number): Date {
    const floor = Math.floor(now.getTime() / NoticePolicy.MINUTE_MS) * NoticePolicy.MINUTE_MS;
    return new Date(floor + n * NoticePolicy.MINUTE_MS);
  }

  /** 그 순간이 시간대에서 하루 중 몇 분인가 */
  private static minuteOfDay(at: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(at);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return part('hour') * 60 + part('minute');
  }
}
