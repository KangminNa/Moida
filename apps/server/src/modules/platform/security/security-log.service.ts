import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseService } from '../base/base-service';
import { SecurityLog, type SecurityNew } from './security-log';

// 보안 기록의 쓰기 가운데 부르는 쪽의 트랜잭션이 없는 것: 거부된 접근(오류 필터)과 보관 기간 지난 줄 지우기(일꾼).
// 로그인처럼 모듈의 쓰기와 함께 남는 기록은 그 모듈이 자기 트랜잭션으로 SecurityLog를 바로 쓴다.
@Injectable()
export class SecurityLogService extends BaseService {
  /** 거부된 접근 하나 (서버 자신만: 오류 필터가 SystemActor로 부른다) */
  async record(actor: Actor, event: SecurityNew): Promise<void> {
    actor.assertOwnerOrSystem();
    await this.transaction(async (tx) => {
      await new SecurityLog(tx).record(event);
    });
  }

  /** 보관 기간(SecurityLog.KEEP_DAYS)이 지난 줄을 지운다 */
  async purge(actor: Actor, now: Date): Promise<number> {
    actor.assertOwnerOrSystem();
    return this.transaction((tx) => new SecurityLog(tx).purge(now));
  }
}
