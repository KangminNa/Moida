import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';

/** 결재 동작 하나와 그 대상 */
export interface ActionTarget {
  action: string;
  targetId: string;
}

// 결재 동작 확인 (2차 6단계): 결과 카드에 싣기 전에, 동작의 대상을 가진 모듈에 "지금 실행하면 무엇이 빠졌나"를 묻는다.
// 예: blog는 메뉴에 올리지 않은 글의 발행을 짚는다 (받을 것 "블로그"의 검사). 모듈이 동작마다 한 번 등록하고,
// 묻는 쪽(task)은 무엇을 보는지 모른다 (Leases와 같은 방식). 등록되지 않은 동작은 보지 않는다
@Injectable()
export class ActionChecks {
  private readonly checks = new Map<
    string,
    (actor: Actor, targetId: string) => Promise<string | null>
  >();

  /** 동작을 실행하는 모듈이 등록한다. 빠진 점이 없으면 null */
  register(
    action: string,
    check: (actor: Actor, targetId: string) => Promise<string | null>,
  ): void {
    if (this.checks.has(action)) throw new Error(`이미 확인을 등록한 결재 동작이에요: ${action}`);
    this.checks.set(action, check);
  }

  /** 동작들의 빠진 점 (없으면 빈 목록) */
  async problemsOf(actor: Actor, items: readonly ActionTarget[]): Promise<string[]> {
    const found: string[] = [];
    for (const item of items) {
      const problem = await this.checks.get(item.action)?.(actor, item.targetId);
      if (problem) found.push(problem);
    }
    return found;
  }
}
