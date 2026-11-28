import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';

/** 러너가 지금 임대를 쥔 일 하나: id · 종류 · 입력 · 대상. 기능 패키지가 러너의 도구 호출을 그 일에 묶을 때 쓴다 */
export class LeasedWork {
  constructor(
    readonly id: string,
    readonly kind: string,
    readonly payload: unknown,
    /** 일의 대상 (플러그인 API 0.4): 종류 · id · 판. 대상이 없는 일은 모두 null */
    readonly targetKind: string | null = null,
    readonly targetId: string | null = null,
    readonly targetVersion: number | null = null,
    /** 일의 지시 (플러그인 API 0.5, 2026-11-16): 되풀이되는 일을 알아채려고 (browser-tabs의 사이트 도구 제안) */
    readonly instruction: string = '',
    /**
     * 관리자가 쓴 지시 (플러그인 API 0.7, 2026-11-19): 위임된 일이면 맨 위 일의 제목과 지시 (하위 일의 지시는 AI가 썼다).
     * read_url의 기준과 같은 글. browser-tabs가 로그인 카드를 띄울 믿는 주소인지 본다
     */
    readonly ownerText: string = '',
  ) {}
}

/**
 * 러너가 올리려는 에이전트 실행의 기록이 들어갈 자리 (작업 세션, 기획서 결정 2026-11-17).
 * vault가 원문 · 인수인계 메모를 쌓을 때 묻는다: 어느 작업 세션(요청 하나)의 몇 번째 실행인지, 같은 CLI 세션을 이어 쓸 세션 키
 */
export class RunRecordTarget {
  constructor(
    readonly taskId: string,
    /** 이 작업의 몇 번째 실행 */
    readonly runSeq: number,
    /** 세션 키: 같은 키의 실행들이 CLI 세션 · 인수인계 메모를 이어 받는다 */
    readonly lineage: string,
    /** 작업 세션의 열쇠: chat:<대화> · goal-run:<실행> · task:<맨 위 작업> */
    readonly flow: string,
    readonly flowTitle: string,
    readonly taskTitle: string,
    readonly agentId: string | null,
    readonly agentName: string,
    /** 일한 AI 도구 (엔진 이름: claude · codex) */
    readonly tool: string,
  ) {}
}

/**
 * 끝난 요청 (S2, 2026-11-28): 작업 세션(flow) 하나의 요청이 끝났는지. done이면 그때까지의 기록을 wiki로 정리하고,
 * 아니면(취소 · 실패 · 결과 카드 반려) 원문으로만 둔다. 아직 결과 카드를 기다리면 묻는 쪽에 null이 간다
 */
export class SettledFlow {
  constructor(
    readonly flow: string,
    readonly done: boolean,
  ) {}
}

// 임대 확인 (기능 패키지 API 0.3): 패키지는 코어의 표를 읽지 못하므로, 러너가 부른 도구가
// "이 러너가 지금 그 일을 쥐고 있는가"를 물을 길을 둔다. 일을 빌려 주는 모듈이 시작할 때 확인하는 길을 등록하고,
// 패키지는 work.leased(id)로 묻는다. platform은 누가 등록하는지 모른다 (SecretRotation · BlobStore.registerUse와 같은 방식).
@Injectable()
export class Leases {
  private check: ((actor: Actor, id: string) => Promise<LeasedWork>) | null = null;
  private recordCheck: ((actor: Actor, id: string) => Promise<RunRecordTarget>) | null = null;
  private settledCheck:
    | ((
        actor: Actor,
        spaceId: string,
        taskId: string,
        card: boolean,
      ) => Promise<SettledFlow | null>)
    | null = null;

  /**
   * 일을 빌려 주는 모듈이 한 번 등록한다 (S2): 상태가 바뀐 작업(id) · 정한 결재(card면 id가 결재)로 작업 세션의 요청이
   * 끝났는지. 요청의 맨 위가 아니거나 아직 끝나지 않았으면 null
   */
  registerSettled(
    check: (
      actor: Actor,
      spaceId: string,
      id: string,
      card: boolean,
    ) => Promise<SettledFlow | null>,
  ): void {
    if (this.settledCheck) throw new Error('끝난 요청의 확인은 한 곳만 등록해요');
    this.settledCheck = check;
  }

  /** 끝난 요청. 확인할 모듈이 없으면 null (작업 세션을 정리하지 않는다) */
  settled(actor: Actor, spaceId: string, id: string, card: boolean): Promise<SettledFlow | null> {
    return this.settledCheck ? this.settledCheck(actor, spaceId, id, card) : Promise.resolve(null);
  }

  /**
   * 일을 빌려 주는 모듈이 한 번 등록한다: 러너가 실행의 기록을 올릴 수 있는 작업인지 (그 러너가 잡았고 점유 시간이 남았으며,
   * 위임 · 승인으로 기다리는 중이어도 된다). 아니면 check가 던진다 (RuleViolation · NotFound)
   */
  registerRecord(check: (actor: Actor, id: string) => Promise<RunRecordTarget>): void {
    if (this.recordCheck) throw new Error('실행 기록의 자리 확인은 한 곳만 등록해요');
    this.recordCheck = check;
  }

  /** 이 러너가 기록을 올릴 수 있는 작업의 자리. 확인할 모듈이 없으면 오류 (서버 구성이 틀렸다) */
  forRecord(actor: Actor, id: string): Promise<RunRecordTarget> {
    if (!this.recordCheck) throw new Error('실행 기록의 자리를 확인할 모듈이 등록되지 않았어요');
    return this.recordCheck(actor, id);
  }

  /** 일을 빌려 주는 모듈이 한 번 등록한다. 쥐고 있지 않으면 check가 던진다 (RuleViolation · NotFound) */
  register(check: (actor: Actor, id: string) => Promise<LeasedWork>): void {
    if (this.check) throw new Error('임대 확인은 한 곳만 등록해요');
    this.check = check;
  }

  /** 이 요청자가 지금 쥔 일. 확인할 모듈이 없으면 오류 (서버 구성이 틀렸다) */
  of(actor: Actor, id: string): Promise<LeasedWork> {
    if (!this.check) throw new Error('임대를 확인할 모듈이 등록되지 않았어요');
    return this.check(actor, id);
  }
}
