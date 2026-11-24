import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import postgres from 'postgres';
import { Busy } from './errors';

// DB 연결과 트랜잭션. `postgres` 라이브러리를 import하는 유일한 파일이다.
// ORM 등을 붙일 때는 이 클래스에 추가하고, 모듈 코드는 BaseRepository·BaseQuery를 통해서만 쓴다.
// 연결 규칙은 platform/CLAUDE.md "DB 연결": 프로세스마다 풀 하나, 연결마다 시간 제한(LIMITS).

/** SQL 실행기 (연결 또는 트랜잭션). 외부 라이브러리 타입을 가리키는 별칭 */
export type Sql = postgres.Sql;
export type Row = postgres.Row;

/**
 * 채널 하나를 듣는 전용 연결 (Postgres LISTEN, 리팩토링 2단계 worker 정책).
 * 라이브러리의 sql.listen은 끊기면 한 번만 다시 듣고 그 실패를 삼킨다: 그러면 듣는 쪽은 신호를 영영 못 받는다.
 * 그래서 연결을 직접 쥐고, 닫히면(onclose) 1 · 2 · 4 … 30초 간격으로 될 때까지 다시 LISTEN한다.
 * 끊긴 동안의 신호는 사라진다: 신호는 깨우기용이고 내용은 늘 테이블에 있다. 그래서 들을 때마다(처음 · 다시) onReady를 부른다.
 * 알림은 라이브러리가 sql.listen 안에서 쓰는 옵션(onnotify, 타입에는 없다)으로 받는다. 라이브러리를 올리면 이 자리를 확인한다
 */
export class Listener {
  private static readonly RETRY_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
  private static readonly logger = new Logger('듣기');
  /** 처음 들을 때 풀린다. 처음 시도가 실패하면 거절되지만 다시 듣기는 뒤에서 이어진다 */
  readonly ready: Promise<void>;
  private readonly sql: Sql;
  private retry: NodeJS.Timeout | null = null;
  private failures = 0;
  private stopped = false;

  constructor(
    url: string,
    private readonly channel: string,
    onMessage: (payload: string) => void,
    private readonly onReady?: () => void,
  ) {
    const options = {
      max: 1,
      idle_timeout: null,
      max_lifetime: null,
      fetch_types: false,
      connection: Database.SESSION,
      onclose: () => this.schedule(),
      onnotify: (from: string, payload: string) => {
        if (from === channel && !this.stopped) onMessage(payload);
      },
    };
    this.sql = postgres(url, options as unknown as postgres.Options<Record<string, never>>);
    this.ready = this.attempt();
    this.ready.catch(() => {}); // 기다리는 쪽이 없어도 처리되지 않은 거절이 되지 않게
  }

  /** 그만 듣는다. 다시 듣기도 멈추고 연결을 닫는다 */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    await this.sql.end({ timeout: 5 });
  }

  private async attempt(): Promise<void> {
    try {
      await this.sql.unsafe(`LISTEN "${this.channel.replaceAll('"', '""')}"`);
    } catch (error) {
      if (this.failures++ === 0 && !this.stopped)
        Listener.logger.warn(
          `${this.channel}을(를) 듣지 못해 다시 시도해요: ${(error as Error).message}`,
        );
      this.schedule();
      throw error;
    }
    if (this.failures > 0) Listener.logger.log(`${this.channel}을(를) 다시 들어요`);
    this.failures = 0;
    if (!this.stopped) this.onReady?.();
  }

  /** 연결이 닫혔거나 듣지 못했다: 그만 들은 게 아니면 잠시 뒤 다시 듣는다 (이미 기다리는 중이면 그대로) */
  private schedule(): void {
    if (this.stopped || this.retry) return;
    const wait = Listener.RETRY_MS[Math.min(this.failures, Listener.RETRY_MS.length - 1)];
    this.retry = setTimeout(() => {
      this.retry = null;
      if (!this.stopped) this.attempt().catch(() => {});
    }, wait);
  }
}

@Injectable()
export class Database implements OnApplicationShutdown {
  /**
   * 코어 모듈이 쓰는 스키마 (apps/server/modules.json의 schemas: 경계 검사가 맞춰 본다).
   * 서버 이미지에는 modules.json이 없어 여기 한 곳에 둔다 (상태 확인의 표 수, 기능 패키지가 못 쓰는 이름)
   */
  static readonly MODULE_SCHEMAS: readonly string[] = [
    'platform',
    'account',
    'vault',
    'blog',
    'work',
    'task',
    'community',
    'mcp',
  ];
  /**
   * 연결마다 거는 시간 제한. 풀과 LISTEN 연결이 모두 시작할 때 받는다.
   * 잠금 하나를 오래 쥔 쪽이 있어도 기다리는 요청이 연결을 붙잡고 풀(10개)을 다 쓰지 않게 한다.
   * 잠금 대기 · 긴 쿼리는 입구에서 Busy(503)가 되고, 쉬다 끊긴 트랜잭션은 우리 코드의 버그라 500으로 둔다.
   * 값은 밀리초 (Postgres는 단위 없는 값을 밀리초로 읽는다)
   */
  static readonly LIMITS = {
    /** 잠금을 5초 넘게 기다리지 않는다 (트랜잭션은 짧다는 원칙상 넘을 일이 없다) */
    lock_timeout: 5_000,
    /** 쿼리 하나는 30초까지 (검색 같은 무거운 읽기에 여유) */
    statement_timeout: 30_000,
    /** 트랜잭션을 연 채 60초 쉬면 끊어 잠금을 푼다 */
    idle_in_transaction_session_timeout: 60_000,
  } as const;
  /**
   * 연결마다 거는 값: 시간 제한(LIMITS)과 JIT 끄기 (2026-11-24 속도). 모으는 쿼리(토큰 합계 · 성적표)마다 JIT 컴파일에
   * 300ms 넘게 쓰고 실행은 몇 ms라 짧은 쿼리가 많은 이 서버에서는 손해다 (같은 쿼리가 켜면 389ms, 끄면 24ms, 실행 기록 39만 줄)
   */
  static readonly SESSION = { ...Database.LIMITS, jit: 'off' } as const;
  /** 시간 제한에 걸린 오류의 코드: 잠금 대기(lock_not_available), 긴 쿼리(query_canceled) */
  private static readonly TIMED_OUT: readonly string[] = ['55P03', '57014'];
  /** bigint도 number로 읽는다. 쓰는 값(토큰 수, 파일 크기, 순번)은 안전한 정수 범위 안이다 */
  private static readonly BIGINT = { to: 20, from: [20], serialize: String, parse: Number };
  readonly sql: Sql;
  private readonly url: string;
  /** 이 프로세스가 연 듣기. 내려갈 때 함께 닫는다 */
  private readonly listeners = new Set<Listener>();

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    this.url = url;
    this.sql = postgres(url, {
      max: 10,
      types: { bigint: Database.BIGINT },
      connection: Database.SESSION,
    });
  }

  /** 짧은 트랜잭션 하나. 안에서 외부 호출이나 AI 응답을 기다리지 않는다 (LIMITS 안에서 돈다) */
  transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
    return this.sql.begin((tx) => work(tx as unknown as Sql)) as Promise<T>;
  }

  /**
   * 시간 제한 없는 트랜잭션. 복원(쓰기)과 복원을 피하는 읽기(steadyRead) 두 곳만 쓴다:
   * 큰 복원은 오래 걸리고, steadyRead는 읽는 동안 잠금만 쥐고 쉰다. 새 자리에 쓰기 전에 일을 나눌 수 있는지 먼저 본다.
   * SET LOCAL이라 이 트랜잭션이 끝나면 연결은 LIMITS로 돌아간다
   */
  unlimitedTransaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      for (const name of Object.keys(Database.LIMITS))
        await tx`SELECT set_config(${name}, '0', true)`;
      return work(tx);
    });
  }

  /** 시간 제한(LIMITS)에 걸린 오류면 Busy, 아니면 null. 입구(REST 필터, MCP)가 응답을 만들 때 묻는다 */
  static busy(error: unknown): Busy | null {
    return error instanceof postgres.PostgresError && Database.TIMED_OUT.includes(error.code)
      ? new Busy()
      : null;
  }

  /**
   * 채널을 듣는다 (Postgres LISTEN, 듣기마다 전용 연결 하나: Listener). 끊기면 될 때까지 다시 듣는다.
   * onReady는 처음 들을 때와 다시 들을 때마다 불린다. 끊긴 동안 놓친 신호는 여기서 테이블을 다시 봐서 메운다.
   * 돌려준 Listener의 stop으로 그만 듣는다. 내려갈 때 남은 듣기는 Database가 닫는다
   */
  listen(channel: string, onMessage: (payload: string) => void, onReady?: () => void): Listener {
    const listener = new Listener(this.url, channel, onMessage, onReady);
    this.listeners.add(listener);
    return listener;
  }

  /** 유일 제약에 걸린 오류인가 (동시에 같은 것을 만들려 할 때). Repository가 Conflict로 바꾼다 */
  static isUniqueViolation(error: unknown, constraint?: string): boolean {
    if (!(error instanceof postgres.PostgresError) || error.code !== '23505') return false;
    return constraint === undefined || error.constraint_name === constraint;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.listeners].map((l) => l.stop()));
    this.listeners.clear();
    await this.sql.end({ timeout: 5 });
  }
}
