import { RuleViolation } from '../../platform';

/** 판단 하나의 모양 (소식 kind decision의 data): 고른 안 · 다른 안 · 까닭 · 무게 · 어느 단계 */
export interface DecisionNoteRow {
  chosen: string;
  alternatives: string[];
  why: string;
  weight: string;
  step: string | null;
}

// 중간 판단 알림 (L1, 기획서 결정 2026-11-17 "중간 판단 알림과 검증 루프"): 일하는 도중의 판단은 멈추지 않고 대화에 바로 온다.
// 소식의 글(text)은 무엇을 정했는지 한 줄, 모양은 chat_updates.data. 관리자는 화면에서 "바꾸기"로 고쳐 말하고,
// 그 말은 회차의 덧붙인 말이 되어 대표의 다음 실행에 들어간다 (회차가 팀원을 기다리는 중이면 먼저 깨운다, SubtaskWait.CHANGE).
// 무게: low(그냥 알림) · medium · high(결과를 크게 바꾸는 판단, 화면이 눈에 띄게). 상태 없음
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 입력과 ChatUpdateService가 쓴다
export class DecisionNote {
  static readonly WEIGHTS = ['low', 'medium', 'high'] as const;
  static readonly CHOSEN_MAX = 300;
  static readonly WHY_MAX = 500;
  static readonly ALTERNATIVES_MAX = 3;
  static readonly ALTERNATIVE_MAX = 200;
  static readonly STEP_MAX = 100;
  private static readonly KIND = 'decision';

  /** 소식에 둘 모양: 판단(decision)만 모양을 받고, 다른 종류에 주면 RuleViolation. 주지 않으면 null */
  static dataFor(kind: string, note: DecisionNoteRow | null): Record<string, unknown> | null {
    if (note === null) return null;
    if (kind !== DecisionNote.KIND)
      throw new RuleViolation('decision 칸은 kind가 decision일 때만 적어요');
    if (!(DecisionNote.WEIGHTS as readonly string[]).includes(note.weight))
      throw new RuleViolation(`무게는 ${DecisionNote.WEIGHTS.join(' · ')} 중 하나예요`);
    return { ...note };
  }
}
