import { Injectable } from '@nestjs/common';

/** 민감정보를 지운 자리 하나. 값은 남기지 않고 어느 칸에서 무엇을 지웠는지만 */
export class Redaction {
  static readonly SECRET = 'secret';

  constructor(
    readonly section: string,
    readonly label: string,
  ) {}

  static restore(raw: Readonly<Record<string, unknown>>): Redaction {
    return new Redaction(String(raw.section ?? ''), String(raw.label ?? ''));
  }

  toJSON(): object {
    return { kind: Redaction.SECRET, section: this.section, label: this.label };
  }
}

// 2차 민감정보 제거: AI가 보낸 글이 판이 되기 전에 서버가 한 번 더 지운다 (1차는 AI 도구의 스킬).
// 판(세션 · wiki · 글)은 고칠 수 없으므로 여기서 놓치면 지울 길이 영구 삭제뿐이다. 그래서 확실한 모양만 지우고,
// 지운 자리에는 `[지움: 종류]`를 남겨 무엇이 있었는지는 알 수 있게 한다. 값은 어디에도 남기지 않는다.
// 비밀값의 모양만 보는 판단이라 공통 기반에 둔다: 무엇을 지울지(어느 칸)는 쓰는 모듈이 정한다.
// 새 종류는 RULES에 한 줄 더한다 (이름, 정규식, 필요하면 값 확인).
// 개인정보(PERSONAL)는 에이전트 실행의 기록(원문 · 인수인계 메모)에만 건다: 사람이 쓴 글의 연락처까지 지우면 안 되어서다 (기획서 결정 2026-11-17).
@Injectable()
export class SensitivePolicy {
  /** [이름, 정규식, 값 확인]. 정규식에 이름 붙은 그룹 `keep`이 있으면 그 부분(예: `password=`)은 남기고 값만 지운다 */
  private static readonly RULES: ReadonlyArray<
    readonly [string, RegExp, ((found: string) => boolean)?]
  > = [
    [
      '개인 키',
      /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
    ],
    ['GitHub 토큰', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g],
    ['AWS 키', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
    ['Slack 토큰', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
    ['Slack 웹훅', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g],
    ['Anthropic API 키', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
    ['OpenAI API 키', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
    ['Google API 키', /\bAIza[0-9A-Za-z_-]{35}\b/g],
    ['Moida 토큰', /\bmoida_(?:at|rt|dt|run)_[A-Za-z0-9_-]{20,}/g],
    ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
    // `password=hunter22`처럼 값이 붙은 것만. 코드 속 `password: string`, `token: process.env.X`는 두고,
    // 숫자가 섞였거나 16자 이상인 값만 지운다
    [
      '비밀번호·키 값',
      /(?<keep>\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|client[_-]?secret|token)\b["']?\s*[:=]\s*["']?)(?!\[지움|process\.env|(?:string|number|null|undefined|true|false)\b)(?=[^\s"'`,;]*\d|[^\s"'`,;]{16})[^\s"'`,;]{6,}/gi,
    ],
  ];

  /** 개인정보: 모양이 확실한 것만. 주민번호는 생년월일 자리까지, 카드 번호는 Luhn 검사까지 맞아야 지운다 */
  private static readonly PERSONAL: ReadonlyArray<
    readonly [string, RegExp, ((found: string) => boolean)?]
  > = [
    [
      '주민등록번호',
      /(?<![\w-])\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[- ]?[1-8]\d{6}(?![\w-])/g,
    ],
    [
      '카드 번호',
      /(?<![\w-])(?:(?:\d{4}[- ]?){3}\d{4}|\d{4}[- ]?\d{6}[- ]?\d{5})(?![\w-])/g,
      (found) => SensitivePolicy.luhn(found.replace(/\D/g, '')),
    ],
    [
      '전화번호',
      /(?<![\w+-])(?:\+82[- ]?|0)(?:1[016789]|2|[3-6][1-5]|70)[- .]?\d{3,4}[- .]?\d{4}(?![\w-])/g,
    ],
    [
      '이메일',
      /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g,
    ],
  ];

  /**
   * 글 하나에서 지운다. section은 지운 자리를 알리는 칸 이름, personal이면 개인정보도 마스킹한다 (에이전트 기록만).
   * [지운 글, 무엇을 지웠는지]
   */
  scrub(section: string, text: string, personal = false): readonly [string, readonly Redaction[]] {
    const found: Redaction[] = [];
    let cleaned = text;
    const rules = personal
      ? [...SensitivePolicy.RULES, ...SensitivePolicy.PERSONAL]
      : SensitivePolicy.RULES;
    for (const [label, pattern, check] of rules) {
      cleaned = cleaned.replace(pattern, (...args) => {
        if (check && !check(String(args[0]))) return String(args[0]);
        found.push(new Redaction(section, label));
        const groups = args.at(-1) as Record<string, string | undefined> | undefined;
        return `${groups?.keep ?? ''}[지움: ${label}]`;
      });
    }
    return [cleaned, found];
  }

  /** 카드 번호의 검사 숫자 (Luhn): 오른쪽에서 두 번째 자리부터 하나 건너 두 배 */
  private static luhn(digits: string): boolean {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    return sum % 10 === 0;
  }
}
