import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseService } from '../base/base-service';
import type { TrashLibraryInput } from './library.input';
import { LibraryTrashedView } from './library.view';

/** 한 종류를 휴지통으로 보내는 길: 보낸 수 (이미 휴지통이거나 없는 것은 세지 않는다) */
type Trasher = (actor: Actor, ids: readonly string[]) => Promise<number>;

// 보관함의 일괄 지우기 (2026-11-23, 사용자 요청 "보관함쪽에 전체삭제"): 보관함처럼 platform은 종류를 모른다.
// 내용을 가진 모듈이 onModuleInit에서 종류마다 register로 자기 휴지통 길(그 모듈의 엔티티 규칙 · 트랜잭션 그대로)을 등록하고,
// 여기서는 고른 줄을 종류별로 나눠 넘긴다. 등록하지 않은 종류(페이지)는 넘기지 않고 skipped로 돌려준다.
// 모두 휴지통이다 (원칙 2: 되살릴 수 있다). 스크랩은 원래 바로 지운다 (가리키던 세션 · 글은 그대로)
@Injectable()
export class LibraryTrashService extends BaseService {
  private readonly trashers = new Map<string, Trasher>();

  register(kinds: readonly string[], trash: Trasher): void {
    const taken = kinds.filter((k) => this.trashers.has(k));
    if (taken.length > 0) throw new Error(`이미 등록된 보관함 지우기예요: ${taken.join(', ')}`);
    for (const kind of kinds) this.trashers.set(kind, trash);
  }

  /** 주인만. 종류마다 그 모듈의 트랜잭션 하나: 한 종류가 실패해도 앞 종류는 이미 휴지통에 있다 */
  async trash(actor: Actor, req: TrashLibraryInput): Promise<LibraryTrashedView> {
    actor.assertOwner();
    let trashed = 0;
    const skipped: string[] = [];
    for (const [kind, ids] of req.byKind) {
      const trash = this.trashers.get(kind);
      if (trash) trashed += await trash(actor, ids);
      else skipped.push(kind);
    }
    return new LibraryTrashedView(trashed, skipped);
  }
}
