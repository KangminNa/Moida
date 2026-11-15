import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseService,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
} from '../../platform';
import { ProjectRule } from './project-rule';
import type { SetProjectRuleInput } from './project-rule.input';
import { ProjectRuleRepository } from './project-rule.repository';
import { ProjectRuleEdit } from './project-rule-edit';

// 프로젝트 규칙 쓰기. 관리자만 (대화에서 제안한 것의 승인도, 2026-11-15 D). 이미 쌓인 원문 · 세션은 그대로 두고 다음 원문부터 따른다
@Injectable()
export class ProjectRuleService extends BaseService {
  async set(actor: Actor, req: SetProjectRuleInput): Promise<void> {
    actor.assertOwner();
    const rule = ProjectRule.set(actor.requireSpace(), req.project, req.collect, new Date());
    await this.transaction((tx) => new ProjectRuleRepository(tx).save(rule));
  }

  /** 설정 바꾸기 제안의 미리 해 보기 (2026-11-15 D): 같은 줄(ProjectRuleEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await new ProjectRuleEdit(tx, spaceId).apply(change, new Date());
    });
  }

  /** 승인한 설정 바꾸기: 결재마다 한 번 적용하고 결과(vault.setting.changed)를 남긴다. 그사이 바뀐 프로젝트가 있으면 실패 */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingOutcome.topicOf('vault'),
      spaceId,
      change.key,
      async (tx) => {
        const rules = new ProjectRuleRepository(tx);
        for (const rule of await new ProjectRuleEdit(tx, spaceId).apply(change, new Date()))
          await rules.save(rule);
      },
    );
  }
}
