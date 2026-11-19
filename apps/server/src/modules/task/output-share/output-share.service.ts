import { Injectable } from '@nestjs/common';
import { type Actor, Database, EntityService, Idempotency, type Sql } from '../../platform';
import { OutputShare } from './output-share';
import type { CreateOutputShareInput, EndOutputShareInput } from './output-share.input';
import { OutputShareQuery } from './output-share.query';
import { OutputShareRepository } from './output-share.repository';
import type { OutputShareView } from './output-share.view';

// 결과물 공유 링크 쓰기 (기획서 결정 2026-11-19). 관리자만 (write 기기 · AI는 안 된다: 바깥 공유는 외부 전송, 원칙 7).
// 만들기는 requestId로 한 번만, 끄기는 몇 번 불러도 같다. 답은 공개 주소가 든 View (같은 모듈의 Query로 읽는다)
@Injectable()
export class OutputShareService extends EntityService<OutputShare> {
  private static readonly CREATE = 'create_output_share';

  constructor(
    db: Database,
    private readonly shares: OutputShareQuery,
  ) {
    super(db);
  }

  protected store(tx: Sql): OutputShareRepository {
    return new OutputShareRepository(tx);
  }

  /** 같은 requestId가 다시 오면 처음 만든 링크를 돌려준다 */
  async create(actor: Actor, req: CreateOutputShareInput): Promise<OutputShareView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.shares.assertShareable(actor, req.outputId);
    const id = await this.transaction(async (tx) => {
      const once = new Idempotency(
        tx,
        actor.id ?? spaceId,
        req.requestId,
        OutputShareService.CREATE,
      );
      const before = await once.previous();
      if (before) return String(before.id);
      const share = OutputShare.open(spaceId, req.outputId, req.days, new Date());
      await this.store(tx).save(share);
      await once.remember({ id: share.id });
      return share.id;
    });
    return this.shares.one(actor, id);
  }

  /** 끈다. 이미 꺼졌거나 기간이 지났어도 그대로 */
  async end(actor: Actor, req: EndOutputShareInput): Promise<OutputShareView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const shares = this.store(tx);
      const share = await shares.lock(spaceId, req.id);
      share.end(new Date());
      await shares.save(share);
    });
    return this.shares.one(actor, req.id);
  }
}
