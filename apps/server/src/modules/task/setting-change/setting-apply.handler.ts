import { Injectable } from '@nestjs/common';
import {
  ApprovedActor,
  BaseHandler,
  type DomainEvent,
  SettingChangeInput,
  SettingKinds,
} from '../../platform';
import { SettingChangeService } from './setting-change.service';

// 승인한 설정 바꾸기를 그 설정을 가진 모듈에 넘긴다 (2026-11-15 D, C의 에이전트 · 스케줄 처리기를 하나로).
// 적용 · 결과(<모듈>.setting.changed)는 그 모듈이 결재마다 한 번 (SettingOutcome). 다루는 모듈이 없으면 실패로 끝낸다.
// 다른 동작의 승인은 넘어간다. 두 번 받아도 결과가 같다
@Injectable()
export class SettingApplyHandler extends BaseHandler {
  static readonly TOPIC = 'task.approval.granted';

  constructor(
    private readonly kinds: SettingKinds,
    private readonly changes: SettingChangeService,
  ) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!SettingChangeInput.carries(event.data)) return;
    const change = SettingChangeInput.approved(event.data);
    const actor = new ApprovedActor(
      event.spaceId,
      String(change.decidedBy),
      change.key,
      SettingKinds.ACTION,
    );
    const kind = this.kinds.of(change.setting);
    if (kind) await kind.apply(actor, change);
    else await this.changes.unhandled(actor, change);
  }
}
