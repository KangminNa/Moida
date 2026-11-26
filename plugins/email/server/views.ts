import type { SendRow, SubscriberRow } from './tables';

// 이 패키지가 내보내는 모양 (콘솔 · 방문자 모두 camelCase)

/** 됐다 · 안 했다 */
export class DoneView {
  constructor(private readonly done: boolean) {}

  toJSON() {
    return { done: this.done };
  }
}

/** 구독을 확인했다: 그 신청의 앱 이름들 */
export class SubscribedView {
  constructor(private readonly apps: readonly string[]) {}

  toJSON() {
    return { apps: [...this.apps] };
  }
}

/** 해지했다: 지운 앱 이름들 (이미 해지했으면 빈 목록) */
export class UnsubscribedView {
  constructor(private readonly apps: readonly string[]) {}

  toJSON() {
    return { apps: [...this.apps] };
  }
}

/** 구독자 한 명 (관리자) */
export class SubscriberView {
  constructor(private readonly row: Readonly<SubscriberRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      appId: r.app_id,
      appName: r.app_name,
      address: r.address,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      confirmedAt: r.confirmed_at?.toISOString() ?? null,
    };
  }
}

/** 소식 한 번 (관리자). waiting: 보내기를 누르면 받을 사람 수 (ready일 때) */
export class SendView {
  constructor(
    private readonly row: Readonly<SendRow>,
    private readonly waiting: number,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      appName: r.app_name,
      title: r.title,
      link: r.link,
      status: r.status,
      total: r.status === 'ready' ? this.waiting : r.total,
      sent: r.sent,
      failed: r.failed,
      createdAt: r.created_at.toISOString(),
      finishedAt: r.finished_at?.toISOString() ?? null,
    };
  }
}

/** 메일 구독 화면 (관리자): 설정이 갖춰졌는지 · 오늘 보낸 수와 상한 · 소식 · 구독자 */
export class OverviewView {
  constructor(
    private readonly ready: boolean,
    private readonly open: boolean,
    private readonly today: number,
    private readonly dailyMax: number,
    private readonly sends: readonly SendView[],
    private readonly people: readonly SubscriberView[],
  ) {}

  toJSON() {
    return {
      ready: this.ready,
      open: this.open,
      today: this.today,
      dailyMax: this.dailyMax,
      sends: this.sends.map((s) => s.toJSON()),
      subscribers: this.people.map((s) => s.toJSON()),
    };
  }
}

/** 일꾼이 보낼 메일 한 통 (반복 작업 ↔ 자기 동작 사이에서만 오간다) */
export class MailItemView {
  constructor(
    readonly kind: 'confirm' | 'post',
    readonly address: string,
    readonly token: string,
    readonly apps: readonly string[],
    /** post일 때: 소식 · 받는 사람 */
    readonly sendId: string | null,
    readonly subscriberId: string | null,
    readonly title: string,
    readonly link: string,
  ) {}

  toJSON() {
    return {
      kind: this.kind,
      address: this.address,
      token: this.token,
      apps: [...this.apps],
      sendId: this.sendId,
      subscriberId: this.subscriberId,
      title: this.title,
      link: this.link,
    };
  }
}

/** 일꾼이 이번에 보낼 메일들 */
export class MailBatchView {
  constructor(private readonly items: readonly MailItemView[]) {}

  toJSON() {
    return { items: this.items.map((i) => i.toJSON()) };
  }
}
