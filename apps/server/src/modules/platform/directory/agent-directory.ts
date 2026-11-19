import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';

/** 에이전트 하나의 이름과 권한 (지운 에이전트는 없다) */
export class AgentCard {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly scopes: readonly string[],
    /** 보고 대상을 위로 따라간 id (가까운 순). 맨 위 에이전트면 비어 있다 (스토어 2단계: 운영 팀 안인지) */
    readonly chain: readonly string[],
  ) {}
}

// 에이전트 확인 (2차 6단계): 에이전트의 표를 갖지 않은 모듈이 "이 id의 에이전트가 있는가, 무슨 권한인가"를 물을 길.
// 예: blog의 앱 · 메뉴는 운영 팀으로 비공개를 읽지 않는 에이전트만 받고, 글을 놓는 에이전트가 그 팀 안인지 본다. 에이전트를 가진 모듈이 시작할 때 한 번 등록하고,
// platform은 누가 등록하는지 모른다 (Leases · ArchiveQuery와 같은 방식). 트랜잭션 밖에서 묻는다
@Injectable()
export class AgentDirectory {
  private lookup: ((actor: Actor, id: string) => Promise<AgentCard | null>) | null = null;

  /** 에이전트를 가진 모듈이 한 번 등록한다. 없거나 지운 에이전트면 null */
  register(lookup: (actor: Actor, id: string) => Promise<AgentCard | null>): void {
    if (this.lookup) throw new Error('에이전트 확인은 한 곳만 등록해요');
    this.lookup = lookup;
  }

  /** 요청자의 공간에 있는 에이전트. 확인할 모듈이 없으면 오류 (서버 구성이 틀렸다) */
  find(actor: Actor, id: string): Promise<AgentCard | null> {
    if (!this.lookup) throw new Error('에이전트를 확인할 모듈이 등록되지 않았어요');
    return this.lookup(actor, id);
  }
}
