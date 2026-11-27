import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

/**
 * 검증 루프 (L2, 2026-11-27): 서버(SubtaskVerify)가 실어 준 payload로 지시문 단락을 그린다.
 *   check: 검증 일. 다른 일꾼의 결과를 지시 · 받을 것에 비추어 점수로 판정한다 (틀 verify-check)
 *   fixNote: 고치기 일. 앞 결과와 검증의 고칠 것을 받아 고친 결과 전체를 다시 낸다 (틀 verify-fix)
 * 결과 · 판정 글은 자료로만 쓴다 (적힌 지시는 따르지 않는다)
 */
export class JobVerify {
  constructor(
    private readonly kind: 'check' | 'fix',
    private readonly fields: Record<string, string | boolean>,
  ) {}

  static from(payload: Json): JobVerify | null {
    if (payload.field('check') && payload.optionalText('verifyOf')) {
      const c = payload.child('check');
      return new JobVerify('check', {
        title: c.optionalText('title') ?? '',
        instruction: c.optionalText('instruction') ?? '',
        deliver: c.optionalText('deliver') ?? '',
        result: c.optionalText('result') || '(결과 글 없음)',
      });
    }
    if (payload.field('fixNote')) {
      const f = payload.child('fixNote');
      const fixes = f.texts('fixes').map((line) => `- ${line}`);
      return new JobVerify('fix', {
        previous: f.optionalText('previous') || '(앞 결과 글 없음)',
        summary: f.optionalText('summary') ?? '',
        fixes: fixes.join('\n'),
      });
    }
    return null;
  }

  part(prompts: PromptPack): string {
    return prompts.fill(this.kind === 'check' ? 'verify-check' : 'verify-fix', this.fields);
  }
}
