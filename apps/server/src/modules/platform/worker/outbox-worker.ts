import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { SystemActor } from '../base/actor';
import type { BaseDueJob } from '../base/base-due-job';
import { BaseEntity } from '../base/base-entity';
import { Database, type Listener } from '../base/database';
import { DomainEvent } from '../base/event';
import { Outbox } from '../base/outbox';
import { Trace } from '../base/trace';
import { FailedEvent } from '../failed-event/failed-event';
import { Notices } from '../notice/notices';
import type { OutboxRow } from '../platform.tables';
import { Leases } from '../plugin/leases';
import { PackageService } from '../plugin/package.service';
import { PluginChats } from '../plugin/plugin-chats';
import type { ScheduledJob } from '../plugin/plugin-context';
import { PluginRegistry } from '../plugin/plugin-registry';
import { CoreWorkers } from './core-workers';
import { WorkScheduler } from './work-scheduler';

// 일꾼: outbox에 쌓인 이벤트를 받는 쪽(Handler)에 넘기고, 코어와 플러그인의 반복 · 마감 작업을 돌린다. (진입 계층)
// 할 일이 없으면 DB를 조회하지 않는다 (리팩토링 2단계 worker 정책): 깰 이유는 신호와 마감 둘뿐이다.
//   깨우기     저장이 커밋되면 오는 신호(LISTEN, 빈 신호)로 바로 돈다
//   다시 시도  남은 이벤트의 가장 이른 next_attempt_at에 깬다. 빌린 뒤 죽은 이벤트도 빌릴 때 2분 뒤로 적혀 같은 길로 돌아온다
//   마감 작업  때가 된 일을 하고 돌려준 시각에 다시 돈다. 그 작업의 주제 이벤트를 처리하거나 `due:<이름>` 신호가 오면 바로
//   다시 듣기  처음 들을 때와 끊겼다 다시 들을 때마다 outbox와 모든 마감 작업을 한 번씩 돈다 (놓친 신호를 메운다)
//   빌리기     한 문장으로 최대 50개를 고르며 다음 시도 시각을 2분 뒤로 미뤄 둔다 (다른 일꾼과 겹치지 않음)
//   넘기기     트랜잭션 밖에서 Handler를 차례로 부른다 (외부 호출이 있어도 잠금을 잡고 있지 않음)
//   결과       모두 성공 → processed_at / 실패 → 점점 늦게 다시 / 8번 실패 → failed_at (지우지 않음) + 관리자에게 알림
//              (같은 트랜잭션, FailedEvent.notice). 관리자가 설정 › 일 › 처리 실패 · 명령줄에서 다시 시도한다 (리팩토링 R1)
//   추적 번호  이벤트를 남긴 요청의 번호(trace_id) 안에서 받는 쪽을 부른다: 로그 · 거기서 남긴 이벤트가 같은 번호를 잇는다.
//              반복 · 마감 작업은 돌 때마다 새 번호 (Trace)
// 일꾼은 하나만 띄운다. 반복 작업(every)은 앞 실행이 안 끝났으면 건너뛰고, 마감 작업은 도는 중에 깨우면 끝난 뒤 한 번 더 돈다.
// DB에 닿지 못하면 1 · 2 · 4 … 10분 뒤에 다시 해 본다.
@Injectable()
export class OutboxWorker implements OnApplicationShutdown {
  private static readonly BATCH = 50;
  private static readonly MAX_ATTEMPTS = 8;
  private static readonly RETRY_MAX_MS = 10 * 60_000;
  /** 같은 일을 다시 돌리는 가장 짧은 간격: 잠긴 줄처럼 지난 마감이 남아 있어도 헛돌지 않게 */
  private static readonly MIN_GAP_MS = 1_000;
  private static readonly OUTBOX = 'outbox';
  private readonly logger = new Logger('일꾼');
  private readonly scheduler = new WorkScheduler();
  private jobTimers: NodeJS.Timeout[] = [];
  private readonly runningJobs = new Set<string>();
  private listener: Listener | null = null;
  private draining = false;
  private wanted = false;
  private drainFailures = 0;
  private readonly dueRunning = new Set<string>();
  private readonly dueAgain = new Set<string>();
  private readonly dueFailures = new Map<string, number>();
  /** 이번 바퀴에 처리한 이벤트로 다시 잴 마감 작업 */
  private readonly dueWoken = new Set<BaseDueJob>();
  private closing = false;

  /** 기능 패키지가 이벤트에 건 동작을 돌린다 (REST · MCP와 같은 순서: 권한 → 입력 → 트랜잭션 → outbox) */
  private readonly packages: PackageService;

  constructor(
    private readonly db: Database,
    private readonly registry: PluginRegistry,
    private readonly core: CoreWorkers,
    /** 이벤트로 도는 패키지 동작에는 러너가 없어 쓰지 않지만, 동작을 돌리는 길이 같아 함께 넘긴다 */
    leases: Leases = new Leases(),
    /** 이벤트로 도는 패키지 동작의 대화 입구 (플러그인 API 0.10): task가 등록한 것과 같은 하나 */
    chats: PluginChats = new PluginChats(),
  ) {
    this.packages = new PackageService(db, registry, leases, chats);
  }

  /** 듣기를 시작한다. 들으면(onReady) 한 번 다 돈다. 처음 듣기가 실패해도 한 번은 돌고, 듣기는 뒤에서 다시 시도된다 */
  start(): void {
    const missing = this.core.missing();
    if (missing.length > 0) throw new Error(`받는 쪽이 없는 필수 이벤트: ${missing.join(', ')}`);
    this.scheduleJobs();
    this.listener = this.db.listen(
      Outbox.CHANNEL,
      (payload) => this.signal(payload),
      () => this.wakeAll(),
    );
    this.listener.ready.catch((error: unknown) => {
      if (this.closing) return;
      this.logger.warn(`신호를 아직 듣지 못해 한 번만 확인해요: ${(error as Error).message}`);
      this.wakeAll();
    });
    this.logger.log('시작했어요');
  }

  /** 코어의 반복 작업과 지금 켜진 플러그인의 반복 작업으로 일정을 다시 짠다 */
  private scheduleJobs(): void {
    for (const t of this.jobTimers) clearInterval(t);
    this.jobTimers = [...this.core.jobs(), ...this.registry.jobs()].map((scheduled) => {
      this.logger.log(
        `반복 작업: ${scheduled.plugin}/${scheduled.job.name} (${scheduled.everyMs / 1000}초마다)`,
      );
      return setInterval(() => void this.runJob(scheduled), scheduled.everyMs);
    });
  }

  /** 한 번 돌린다. 처리한 이벤트 수를 돌려준다 (테스트에서 직접 부른다) */
  async tick(): Promise<number> {
    const rows = await this.db.sql<
      Pick<OutboxRow, 'id' | 'space_id' | 'topic' | 'payload' | 'attempts' | 'trace_id'>[]
    >`
      UPDATE platform.outbox o
         SET attempts = o.attempts + 1, next_attempt_at = now() + interval '2 minutes'
       WHERE o.id IN (
         SELECT id FROM platform.outbox
          WHERE processed_at IS NULL AND failed_at IS NULL
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          ORDER BY id LIMIT ${OutboxWorker.BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.space_id, o.topic, o.payload, o.attempts, o.trace_id`;
    for (const row of rows)
      await Trace.run(row.trace_id ?? BaseEntity.newId(), () => this.deliver(row));
    return rows.length;
  }

  /** 이벤트 하나를 받는 쪽에 넘긴다 (그 이벤트의 추적 번호 안에서) */
  private async deliver(
    row: Pick<OutboxRow, 'id' | 'space_id' | 'topic' | 'payload' | 'attempts'>,
  ): Promise<void> {
    try {
      // Outbox.publish가 적은 객체 ({ v, ...data })
      const payload = row.payload as Record<string, unknown>;
      const event = DomainEvent.fromOutbox(row.topic, row.space_id, payload);
      // 마감을 바꾼 쓰기는 이미 커밋됐다: 받는 쪽이 실패해도 다시 잰다
      for (const job of this.core.duesFor(event)) this.dueWoken.add(job);
      // 플러그인을 켜거나 끄거나 설정을 바꾸면: 재시작 없이 다시 등록하고 일정을 다시 짠다
      if (event.name === 'platform.plugin.changed') {
        await this.registry.reload();
        if (this.listener !== null && !this.closing) this.scheduleJobs();
      }
      for (const handler of this.core.handlersFor(event)) await handler.handle(event);
      for (const sub of this.registry.handlersFor(event)) await sub.handler.handle(event);
      for (const reaction of this.registry.reactionsFor(event))
        await this.packages.run(new SystemActor(), reaction.found, {
          ...event.data,
          spaceId: event.spaceId,
        });
      await this.db
        .sql`UPDATE platform.outbox SET processed_at = now(), last_error = NULL WHERE id = ${row.id}`;
    } catch (error) {
      await this.fail(row, error);
    }
  }

  async runJob(scheduled: ScheduledJob): Promise<void> {
    const key = `${scheduled.plugin}/${scheduled.job.name}`;
    if (this.runningJobs.has(key)) return;
    this.runningJobs.add(key);
    const trace = BaseEntity.newId();
    try {
      await Trace.run(trace, () => scheduled.job.run());
    } catch (error) {
      this.logger.warn(`${trace} ${key} 실패: ${(error as Error).message}`);
    } finally {
      this.runningJobs.delete(key);
    }
  }

  /** 마감 작업 하나를 돌리고 돌려준 시각에 다시 잡는다. 도는 중에 다시 깨우면 끝난 뒤 한 번 더 돈다 */
  async runDue(job: BaseDueJob): Promise<void> {
    if (this.closing) return;
    if (this.dueRunning.has(job.name)) {
      this.dueAgain.add(job.name);
      return;
    }
    this.dueRunning.add(job.name);
    try {
      do {
        this.dueAgain.delete(job.name);
        const started = Date.now();
        const next = await this.dueOnce(job);
        this.at(Outbox.DUE + job.name, next, started, () => void this.runDue(job));
      } while (!this.closing && this.dueAgain.has(job.name));
    } finally {
      this.dueRunning.delete(job.name);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    this.scheduler.stop();
    for (const t of this.jobTimers) clearInterval(t);
    this.jobTimers = [];
    // Database도 함께 닫히는 중이라 실패할 수 있다. 연결이 닫히면 듣기도 끝나므로 넘어간다
    await this.listener?.stop().catch(() => {});
  }

  /** 다시 해 보기까지 기다리는 시간 (DB에 닿지 못했거나 마감 작업이 실패했을 때) */
  protected retryDelayMs(failures: number): number {
    return Math.min(OutboxWorker.RETRY_MAX_MS, 60_000 * 2 ** (failures - 1));
  }

  /** 실패한 이벤트를 다시 시도하기까지 (초): 20초부터 점점 늘려 한 시간까지 */
  protected retryAfterSeconds(attempts: number): number {
    return Math.min(3600, 10 * 2 ** attempts);
  }

  /** 신호: 빈 것은 outbox, `due:<이름>`은 그 마감 작업 (모르는 이름은 넘긴다) */
  private signal(payload: string): void {
    if (!payload.startsWith(Outbox.DUE)) {
      this.wake();
      return;
    }
    const job = this.core.dueJob(payload.slice(Outbox.DUE.length));
    if (job) void this.runDue(job);
  }

  /** 들을 때마다(처음 · 다시): 그동안 놓친 신호를 메우려고 outbox와 모든 마감 작업을 한 번씩 */
  private wakeAll(): void {
    this.wake();
    for (const job of this.core.dueJobs()) void this.runDue(job);
  }

  /**
   * 도는 중에 온 신호는 wanted에 남아 이번 바퀴가 끝난 뒤 한 번 더 돌게 한다.
   * 내려간 뒤의 신호는 무시한다.
   */
  private wake(): void {
    if (this.closing) return;
    this.wanted = true;
    void this.drain();
  }

  /**
   * 할 일이 없을 때까지 돈다. 꽉 찬 묶음 뒤에는 남은 이벤트가 있을 수 있어 다시 돈다.
   * 다 돌면 남은 이벤트의 가장 이른 다음 시도 시각에 깨도록 잡는다 (없으면 신호가 올 때까지 잔다)
   */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    const started = Date.now();
    try {
      let count: number;
      do {
        this.wanted = false;
        count = await this.tick();
        for (const job of this.dueWoken) void this.runDue(job);
        this.dueWoken.clear();
      } while (!this.closing && (this.wanted || count === OutboxWorker.BATCH));
      this.drainFailures = 0;
      this.at(OutboxWorker.OUTBOX, await this.nextAttempt(), started, () => this.wake());
    } catch (error) {
      this.drainFailures += 1;
      this.logger.warn(`이벤트를 읽지 못했어요: ${(error as Error).message}`);
      const retry = new Date(Date.now() + this.retryDelayMs(this.drainFailures));
      this.at(OutboxWorker.OUTBOX, retry, started, () => this.wake());
    } finally {
      this.draining = false;
    }
  }

  /** 남은 이벤트 가운데 가장 이른 다음 시도 시각. 남은 것이 없으면 null */
  private async nextAttempt(): Promise<Date | null> {
    const [row] = await this.db.sql<Pick<OutboxRow, 'next_attempt_at'>[]>`
      SELECT min(coalesce(next_attempt_at, now())) AS next_attempt_at FROM platform.outbox
       WHERE processed_at IS NULL AND failed_at IS NULL`;
    return row?.next_attempt_at ?? null;
  }

  /** 마감 작업을 한 번. 실패하면 늦춰서 다시 */
  private async dueOnce(job: BaseDueJob): Promise<Date | null> {
    const trace = BaseEntity.newId();
    try {
      const next = await Trace.run(trace, () => job.run(new Date()));
      this.dueFailures.delete(job.name);
      return next;
    } catch (error) {
      const failures = (this.dueFailures.get(job.name) ?? 0) + 1;
      this.dueFailures.set(job.name, failures);
      this.logger.warn(`${trace} ${job.name} 실패 (${failures}번째): ${(error as Error).message}`);
      return new Date(Date.now() + this.retryDelayMs(failures));
    }
  }

  /** when에 깨도록 잡는다. 시작한 때에서 MIN_GAP_MS보다 이르면 그만큼 미룬다 (지난 마감이 남아도 헛돌지 않게) */
  private at(key: string, when: Date | null, started: number, run: () => void): void {
    const floor = started + OutboxWorker.MIN_GAP_MS;
    const at = when !== null && when.getTime() < floor ? new Date(floor) : when;
    this.scheduler.at(key, at, run);
  }

  /** 실패: 늦춰서 다시, 8번째면 멈추고 같은 트랜잭션에서 관리자에게 알린다. 로그 줄은 추적 번호로 시작한다 */
  private async fail(
    row: Pick<OutboxRow, 'id' | 'space_id' | 'topic' | 'attempts'>,
    error: unknown,
  ): Promise<void> {
    const { id, attempts } = row;
    const message = error instanceof Error ? error.message : String(error);
    const where = `${Trace.current() ?? '-'} 이벤트 ${id}(${row.topic})`;
    if (attempts >= OutboxWorker.MAX_ATTEMPTS) {
      await this.db.transaction(async (tx) => {
        await tx`UPDATE platform.outbox SET failed_at = now(), last_error = ${message} WHERE id = ${id}`;
        await new Notices(tx).post(FailedEvent.notice(row.space_id, id, row.topic, message));
      });
      this.logger.error(`${where}를 ${attempts}번 실패해서 멈췄어요: ${message}`);
      return;
    }
    this.logger.warn(`${where} 실패 (${attempts}번째), 다시 시도해요: ${message}`);
    const waitSeconds = this.retryAfterSeconds(attempts);
    await this.db.sql`
      UPDATE platform.outbox
         SET next_attempt_at = now() + ${waitSeconds} * interval '1 second', last_error = ${message}
       WHERE id = ${id}`;
  }
}
