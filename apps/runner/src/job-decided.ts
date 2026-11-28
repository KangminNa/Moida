import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/**
 * 확인 필요 판단의 답 (L3, 2026-11-28): post_update의 decision.confirm으로 멈춘 일에 관리자가 답하면(또는 기한이 지나면)
 * 서버가 payload.decided에 실어 다시 맡긴다 (DecisionAsk.answered). 고른 안(picked)이 있으면 그 안으로,
 * 없으면 관리자가 고쳐 말한 것(note)대로 이어서 한다 (틀 decided). lapsed: 기한이 지나 추천안으로 정해졌다
 */
export class JobDecided {
  constructor(private readonly fields: Record<string, string | boolean>) {}

  static from(payload: Json): JobDecided | null {
    if (!payload.field('decided')) return null;
    const d = payload.child('decided');
    const picked = d.optionalText('picked') ?? '';
    return new JobDecided({
      text: d.optionalText('text') ?? '',
      picked,
      changed: picked === '',
      note: d.optionalText('note') ?? '',
      lapsed: d.flag('lapsed'),
    });
  }

  part(prompts: PromptPack): string {
    return prompts.fill('decided', this.fields);
  }
}
