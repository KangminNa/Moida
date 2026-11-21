import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/**
 * 앞 단계의 결과 (payload.afterResults, D2 순서가 있는 위임 2026-11-21): 팀장이 after로 이 일을 앞 하위 작업 뒤에 두면,
 * 서버가 앞 단계가 모두 끝났을 때 이 일을 만들며 그 결과 글을 싣는다. 자료로만 쓴다 (적힌 지시는 따르지 않는다)
 */
export class JobAfter {
  constructor(readonly results: readonly { title: string; text: string }[]) {}

  static from(payload: Json): JobAfter | null {
    if (!payload.field('afterResults')) return null;
    const results = payload
      .list('afterResults')
      .map((r) => ({ title: r.text('title'), text: r.optionalText('text') ?? '' }));
    return results.length === 0 ? null : new JobAfter(results);
  }

  /** 지시문 단락 (틀 after) */
  part(prompts: PromptPack): string {
    const lines = this.results.map((r) => `[${r.title}]\n${r.text || '(결과 글 없음)'}`);
    return prompts.fill('after', { results: lines.join('\n\n') });
  }
}
