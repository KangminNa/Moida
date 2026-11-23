import { RuleViolation } from '../../platform';

// 글의 태그 규칙 (Post의 RULES가 쓴다): 앞뒤 빈칸 · # 지우기, 빈 것 · 겹치는 것 빼기, 개수와 길이의 한도.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 태그 규칙 한 곳
export class PostTags {
  static readonly MAX = 20;
  static readonly LENGTH_MAX = 40;

  /** 다듬은 태그. 한도를 넘으면 RuleViolation */
  static clean(value: readonly string[]): string[] {
    const clean = [
      ...new Set(value.map((t) => t.trim().replace(/^#+/, '').trim()).filter((t) => t.length > 0)),
    ];
    if (clean.length > PostTags.MAX) throw new RuleViolation(`태그는 ${PostTags.MAX}개까지예요`);
    const long = clean.find((t) => t.length > PostTags.LENGTH_MAX);
    if (long) throw new RuleViolation(`태그는 ${PostTags.LENGTH_MAX}자까지예요: ${long}`);
    return clean;
  }
}
