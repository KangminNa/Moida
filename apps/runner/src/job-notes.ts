import { JobAfter } from './job-after';
import { JobLeadReplies } from './job-lead-replies';
import { JobPlan } from './job-plan';
import { JobRoute } from './job-route';
import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/** 지시문에 더할 payload의 단락 하나 (part로 그린다) */
export interface JobNote {
  part(prompts: PromptPack): string;
}

/**
 * 지시문에 더할 payload의 단락들 (있는 것만, 이 순서로): set_plan으로 정한 계획(JobPlan, 2026-11-20) · 앞 단계의 결과
 * (JobAfter, D2 순서가 있는 위임) · 대표의 답(JobLeadReplies, 2026-11-24 대표 ↔ 일꾼 대화) · 이 일의 방법(JobRoute, C4 2026-11-27)
 */
// biome-ignore lint/complexity/noStaticOnlyClass: payload 단락 고르기 한 곳 (Job이 부른다)
export class JobNotes {
  static from(payload: Json): readonly JobNote[] {
    return [
      JobPlan.from(payload),
      JobAfter.from(payload),
      JobLeadReplies.from(payload),
      JobRoute.from(payload),
    ].flatMap((p) => p ?? []);
  }
}
