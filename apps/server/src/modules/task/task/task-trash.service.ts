import { Injectable } from '@nestjs/common';
import { type Actor, BaseService } from '../../platform';
import type { TaskTrashInput } from './task.input';
import { TaskRepository } from './task.repository';
import { TaskTrashedView } from './task.view';

// 작업 기록의 휴지통 (2026-11-23, 사용자 요청 "작업이랑 보관함쪽에 전체삭제"). 주인만.
// 끝난 작업(완료 · 실패 · 취소)을 작업 기록 목록에서 뺄 뿐 줄은 지우지 않는다 (원칙 2: 실행 기록 · 결과물 · 판정 · 대화의 회차가 가리킨다).
// 상태를 바꾸지 않는 목록 표시라 엔티티 · version을 거치지 않고 조건 하나로 쓴다 (도는 작업은 조건에서 빠진다, DB CHECK가 한 번 더 막는다)
@Injectable()
export class TaskTrashService extends BaseService {
  /** 고른 작업 또는 끝난 작업 모두(ids null)를 휴지통으로. 넣은 수 (도는 작업 · 이미 넣은 것은 세지 않는다) */
  async trash(actor: Actor, req: TaskTrashInput): Promise<TaskTrashedView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    const count = await this.transaction((tx) =>
      new TaskRepository(tx).trashFinished(spaceId, req.ids, now),
    );
    return new TaskTrashedView(count);
  }

  /** 휴지통에서 꺼낸다. 꺼낸 수 */
  async restore(actor: Actor, req: TaskTrashInput): Promise<TaskTrashedView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const count = await this.transaction((tx) =>
      new TaskRepository(tx).restoreTrashed(spaceId, req.ids ?? []),
    );
    return new TaskTrashedView(count);
  }
}
