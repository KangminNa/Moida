import type { ArchiveQuery } from '../archive/archive.query';
import type { ArchiveFile } from '../archive/archive-file';
import type { ArchiveRestoreService } from '../archive/archive-restore.service';
import { SystemActor } from '../base/actor';
import type { BaseAction } from '../base/base-action';
import type { BaseHandler } from '../base/base-handler';
import type { BaseJob } from '../base/base-job';
import type { BaseLogin } from '../base/base-login';
import type { BaseMailer } from '../base/base-mailer';
import { Command, Operation, type Read } from '../base/operation';
import type { PluginManifest } from './plugin-manifest';

/** 등록된 이벤트 받기 하나 */
export class EventSubscription {
  constructor(
    readonly plugin: string,
    readonly pattern: string,
    readonly handler: BaseHandler,
  ) {}
}

/** 이벤트가 오면 코어가 돌리는 기능 패키지의 쓰기 동작 (서버 자신으로, 트랜잭션 하나에서) */
export class EventReaction {
  constructor(
    readonly pattern: string,
    readonly found: PackageOperation,
  ) {}
}

/**
 * 등록된 위임 지킴이 하나 (플러그인 API 0.9, 2026-11-21): 에이전트가 delegate_task로 이 대상 종류(target_kind)의 하위 작업을 맡길 때
 * 코어가 먼저 돌리는 읽기 동작. RuleViolation을 던지면 그 글로 위임이 거절된다
 */
export class DelegateGuard {
  constructor(
    readonly targetKind: string,
    readonly found: PackageOperation,
  ) {}
}

/** 등록된 반복 작업 하나 */
export class ScheduledJob {
  constructor(
    readonly plugin: string,
    readonly job: BaseJob,
    readonly everyMs: number,
  ) {}
}

/** 등록된 관리 동작 하나 */
export class PluginAction {
  constructor(
    readonly plugin: string,
    readonly name: string,
    readonly action: BaseAction,
  ) {}
}

/** 등록된 로그인 방법 하나 */
export class LoginMethod {
  constructor(
    readonly plugin: string,
    readonly name: string,
    readonly login: BaseLogin,
  ) {}
}

/** 등록된 기능 패키지의 동작 하나 */
export class PackageOperation {
  constructor(
    readonly manifest: PluginManifest,
    readonly operation: Operation,
  ) {}
}

// 플러그인이 확장 지점에 등록하는 창구. 목록 파일 `uses`에 적지 않은 것을 쓰면 그 플러그인은 켜지지 않는다.
export class PluginContext {
  readonly subscriptions: EventSubscription[] = [];
  readonly jobs: ScheduledJob[] = [];
  readonly actions: PluginAction[] = [];
  readonly logins: LoginMethod[] = [];
  readonly operations: PackageOperation[] = [];
  readonly reactions: EventReaction[] = [];
  readonly guards: DelegateGuard[] = [];
  /** 코어의 확인 메일을 보내는 길 (provideMail) */
  mailer: BaseMailer | null = null;

  constructor(
    private readonly manifest: PluginManifest,
    private readonly values: ReadonlyMap<string, string>,
    private readonly archive: ArchiveQuery,
    private readonly restore: ArchiveRestoreService,
  ) {}

  /** 자기 설정 값 전부 (비밀값은 풀어서, 비어 있으면 기본값). 다른 플러그인의 설정은 볼 수 없다 */
  settings(): ReadonlyMap<string, string> {
    return this.values;
  }

  /**
   * 이벤트 받기. 처리기(BaseHandler)를 넘기거나, 기능 패키지는 쓰기 동작(Command)을 넘긴다:
   * 그 동작은 코어(일꾼)가 서버 자신으로 트랜잭션 하나에서 돌리고(입력은 이벤트의 내용 + spaceId),
   * 남긴 이벤트는 같은 트랜잭션의 outbox로 나간다. allow는 Operation.SYSTEM이어야 한다
   */
  onEvent(pattern: string, handler: BaseHandler | Command): void {
    this.require(`event:${pattern}`);
    if (handler instanceof Command) {
      if (handler.allow !== Operation.SYSTEM)
        throw new Error(
          `이벤트로 도는 동작은 allow가 Operation.SYSTEM이어야 해요: ${handler.name}`,
        );
      this.reactions.push(new EventReaction(pattern, new PackageOperation(this.manifest, handler)));
      return;
    }
    this.subscriptions.push(new EventSubscription(this.manifest.name, pattern, handler));
  }

  /**
   * 위임 지킴이: 이 대상 종류의 하위 작업을 맡기는 delegate_task를 코어가 먼저 보여 준다 (맡기는 에이전트의 actor,
   * 입력 space_id · agent_id · task_id · target_kind · target_id · kind · title · instruction). 읽기 동작(Read)만:
   * 코어의 트랜잭션 밖에서 돌고, 거절은 RuleViolation으로. 목록 파일에 delegate:<대상 종류>가 있어야 한다
   */
  guardDelegate(targetKind: string, guard: Read): void {
    this.require(`delegate:${targetKind}`);
    if (guard.writes) throw new Error(`위임 지킴이는 읽기 동작(Read)이어야 해요: ${guard.name}`);
    this.guards.push(new DelegateGuard(targetKind, new PackageOperation(this.manifest, guard)));
  }

  /** every('30s' | '5m' | '1h', job) */
  every(interval: string, job: BaseJob): void {
    this.require(`job:${job.name}`);
    this.jobs.push(
      new ScheduledJob(this.manifest.name, job, PluginContext.parseInterval(interval)),
    );
  }

  addAction(name: string, action: BaseAction): void {
    this.require(`action:${name}`);
    this.actions.push(new PluginAction(this.manifest.name, name, action));
  }

  /** 로그인 방법. 이름이 로그인 주소가 된다 (/api/auth/login/<이름>/…) */
  addLogin(name: string, login: BaseLogin): void {
    this.require(`login:${name}`);
    this.logins.push(new LoginMethod(this.manifest.name, name, login));
  }

  /**
   * 코어가 보내는 확인 메일(인증코드)의 길 (플러그인 API 0.14). 목록 파일의 uses에 mail이 있어야 한다.
   * 여러 플러그인이 등록하면 먼저 켠 것만 쓴다
   */
  provideMail(mailer: BaseMailer): void {
    this.require('mail');
    this.mailer = mailer;
  }

  /**
   * 기능 패키지의 동작. 목록 파일의 api나 tools가 이 동작의 이름을 가리켜야 열린다
   * (가리키는 곳이 없는 동작은 쓸 길이 없어 등록하지 않는다)
   */
  addOperation(operation: Operation): void {
    const routed = [...this.manifest.api.values()].includes(operation.name);
    const tooled = [...this.manifest.tools.values()].some((t) => t.operation === operation.name);
    // 반복 작업만 부르는 동작 (0.13): 서버 자신만(SYSTEM) 부를 수 있고, 반복 작업을 허락받은 패키지에만
    const jobOnly =
      operation.allow === Operation.SYSTEM &&
      [...this.manifest.uses].some((u) => u.startsWith('job:'));
    if (!routed && !tooled && !jobOnly)
      throw new Error(`목록 파일의 api · tools가 가리키지 않는 동작이에요: ${operation.name}`);
    if (routed) this.require('api');
    for (const [tool, spec] of this.manifest.tools)
      if (spec.operation === operation.name) this.require(`tool:${tool}`);
    if (this.operations.some((o) => o.operation.name === operation.name))
      throw new Error(`같은 이름의 동작이 둘이에요: ${operation.name}`);
    this.operations.push(new PackageOperation(this.manifest, operation));
  }

  /**
   * 보관 형식 파일을 읽는 함수. 서버 자신의 자격으로 읽으므로 목록 파일에 archive:read가 있어야 한다.
   * 복원과 겹치지 않게 읽어서, 동기화가 절반만 복원된 모습을 보고 원격 파일을 지우는 일이 없다.
   */
  archiveReader(): () => Promise<readonly ArchiveFile[]> {
    this.require('archive:read');
    return () => this.restore.steadyRead(() => this.archive.files(new SystemActor()));
  }

  /** 보관 파일을 빈 Cairn에 들여오는 창구. 부른 사람이 주인이어야 한다. 목록 파일에 archive:restore가 있어야 한다 */
  archiveRestorer(): ArchiveRestoreService {
    this.require('archive:restore');
    return this.restore;
  }

  private require(use: string): void {
    if (!this.manifest.allows(use)) {
      throw new Error(
        `플러그인 ${this.manifest.name}이(가) 목록 파일에 없는 확장 지점을 쓰려 해요: ${use}`,
      );
    }
  }

  private static parseInterval(interval: string): number {
    const m = /^(\d+)(s|m|h)$/.exec(interval);
    if (!m) throw new Error(`간격 형식이 아니에요: ${interval} (예: 30s, 5m, 1h)`);
    const ms = Number(m[1]) * { s: 1_000, m: 60_000, h: 3_600_000 }[m[2] as 's' | 'm' | 'h'];
    if (ms < 10_000) throw new Error(`간격은 10초 이상이어야 해요: ${interval}`);
    return ms;
  }
}
