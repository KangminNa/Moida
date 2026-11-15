import { Injectable } from '@nestjs/common';
import type { BaseDueJob } from '../base/base-due-job';
import type { BaseHandler } from '../base/base-handler';
import type { BaseJob } from '../base/base-job';
import type { DomainEvent } from '../base/event';
import { EventSubscription, ScheduledJob } from '../plugin/plugin-context';

// 코어 모듈이 일꾼에게 이벤트 받기와 반복 작업 · 마감 작업을 맡기는 자리. 모듈은 onModuleInit에서 등록한다.
// 마감 작업(due, 리팩토링 2단계)은 다음에 깰 시각을 스스로 정한다. 정해진 간격(every)은 본래 주기가 있는 정리에만 쓴다.
// 받는 쪽이 없는 이벤트는 처리됨으로 넘어가 사라진다. 꼭 받아야 하는 주제는 expect로 적어 두면 일꾼이 뜰 때 잡는다.
@Injectable()
export class CoreWorkers {
  private static readonly OWNER = 'core';
  private readonly subscriptions: EventSubscription[] = [];
  private readonly scheduled: ScheduledJob[] = [];
  private readonly dues = new Map<string, BaseDueJob>();
  /** 주제 무늬 → 그 이벤트를 처리하면 다시 잴 마감 작업 */
  private readonly dueWakes: (readonly [string, BaseDueJob])[] = [];
  private readonly expected = new Set<string>();

  on(pattern: string, handler: BaseHandler): void {
    this.subscriptions.push(new EventSubscription(CoreWorkers.OWNER, pattern, handler));
  }

  every(job: BaseJob, everyMs: number): void {
    this.scheduled.push(new ScheduledJob(CoreWorkers.OWNER, job, everyMs));
  }

  /** 마감 작업. wakeTopics의 이벤트를 처리하면 바로 다시 잰다 (마감을 바꾸는 쓰기가 남기는 이벤트) */
  due(job: BaseDueJob, ...wakeTopics: string[]): void {
    if (this.dues.has(job.name)) throw new Error(`이미 등록된 마감 작업이에요: ${job.name}`);
    this.dues.set(job.name, job);
    for (const topic of wakeTopics) this.dueWakes.push([topic, job]);
  }

  /** 이 주제는 코어에 받는 쪽이 있어야 한다 */
  expect(topic: string): void {
    this.expected.add(topic);
  }

  handlersFor(event: DomainEvent): readonly BaseHandler[] {
    return this.subscriptions.filter((s) => event.matches(s.pattern)).map((s) => s.handler);
  }

  jobs(): readonly ScheduledJob[] {
    return this.scheduled;
  }

  dueJobs(): readonly BaseDueJob[] {
    return [...this.dues.values()];
  }

  /** 이름으로 찾은 마감 작업 (Outbox.wake의 신호) */
  dueJob(name: string): BaseDueJob | null {
    return this.dues.get(name) ?? null;
  }

  /** 이 이벤트로 다시 잴 마감 작업 */
  duesFor(event: DomainEvent): readonly BaseDueJob[] {
    return [...new Set(this.dueWakes.filter(([p]) => event.matches(p)).map(([, job]) => job))];
  }

  /** 듣는 무늬 전부 (받기 · 마감 작업을 깨우는 주제 · 필수 주제): 일꾼이 시작할 때 이벤트 목록과 맞춰 본다 */
  patterns(): readonly string[] {
    return [
      ...this.subscriptions.map((s) => s.pattern),
      ...this.dueWakes.map(([p]) => p),
      ...this.expected,
    ];
  }

  /** 받는 쪽이 없는 필수 주제 */
  missing(): readonly string[] {
    return [...this.expected].filter(
      (topic) => !this.subscriptions.some((s) => CoreWorkers.covers(s.pattern, topic)),
    );
  }

  private static covers(pattern: string, topic: string): boolean {
    return pattern === topic || (pattern.endsWith('.*') && topic.startsWith(pattern.slice(0, -1)));
  }
}
