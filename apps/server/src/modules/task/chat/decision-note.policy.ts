import { RuleViolation } from '../../platform';
import type { ChatStopMode } from '../task.tables';

/**
 * 판단 하나의 모양 (소식 kind decision의 data): 고른 안 · 다른 안 · 까닭 · 무게 · 어느 단계,
 * 확인 필요의 까닭(confirm, L3)과 답을 기다릴 분(wait_minutes)
 */
export interface DecisionNoteRow {
  chosen: string;
  alternatives: string[];
  why: string;
  weight: string;
  step: string | null;
  confirm: string | null;
  wait_minutes: number;
}

// 중간 판단 알림 (L1, 기획서 결정 2026-11-17 "중간 판단 알림과 검증 루프"): 일하는 도중의 판단은 멈추지 않고 대화에 바로 온다.
// 소식의 글(text)은 무엇을 정했는지 한 줄, 모양은 chat_updates.data. 관리자는 화면에서 "바꾸기"로 고쳐 말하고,
// 그 말은 회차의 덧붙인 말이 되어 대표의 다음 실행에 들어간다 (회차가 팀원을 기다리는 중이면 먼저 깨운다, SubtaskWait.CHANGE).
// 무게: low(그냥 알림) · medium · high(결과를 크게 바꾸는 판단, 화면이 눈에 띄게). 상태 없음
// 확인 필요 판단 (L3, 2026-11-28): confirm(반복 한도 · 방향 바꿈 · 되돌리기 어려움)을 적은 판단은 대화의 멈춤 기준에 따라
// 고를 안이 있는 승인(task.decision)으로 멈춘다 (stops). 기한(wait_minutes)이 지나면 고른 안(추천안)으로 이어서 하고,
// 되돌리기 어려운 판단은 기한 없이 사람의 답을 기다린다 (예약 · 결제의 빈 정보는 가정하지 않는다)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 입력과 ChatUpdateService가 쓴다
export class DecisionNote {
  static readonly WEIGHTS = ['low', 'medium', 'high'] as const;
  static readonly CHOSEN_MAX = 300;
  static readonly WHY_MAX = 500;
  static readonly ALTERNATIVES_MAX = 3;
  static readonly ALTERNATIVE_MAX = 200;
  static readonly STEP_MAX = 100;
  static readonly CONFIRMS = ['repeat_limit', 'direction', 'irreversible'] as const;
  static readonly IRREVERSIBLE = 'irreversible';
  static readonly WAIT_DEFAULT = 30;
  static readonly WAIT_MIN = 5;
  static readonly WAIT_MAX = 1440;
  private static readonly KIND = 'decision';

  /** 소식에 둘 모양: 판단(decision)만 모양을 받고, 다른 종류에 주면 RuleViolation. 주지 않으면 null */
  static dataFor(kind: string, note: DecisionNoteRow | null): Record<string, unknown> | null {
    if (note === null) return null;
    if (kind !== DecisionNote.KIND)
      throw new RuleViolation('decision 칸은 kind가 decision일 때만 적어요');
    if (!(DecisionNote.WEIGHTS as readonly string[]).includes(note.weight))
      throw new RuleViolation(`무게는 ${DecisionNote.WEIGHTS.join(' · ')} 중 하나예요`);
    if (
      note.confirm !== null &&
      !(DecisionNote.CONFIRMS as readonly string[]).includes(note.confirm)
    )
      throw new RuleViolation(
        `확인 필요의 까닭은 ${DecisionNote.CONFIRMS.join(' · ')} 중 하나예요`,
      );
    // 확인 필요의 까닭 · 기다릴 분은 확인 필요 판단에만 남긴다 (L1의 알림 판단은 모양 그대로)
    const { confirm, wait_minutes, ...shape } = note;
    return confirm === null ? shape : { ...shape, confirm, wait_minutes };
  }

  /**
   * 이 판단에서 멈추는가 (대화의 멈춤 기준): all은 판단마다, confirm(기본)은 확인 필요 판단만,
   * end는 끝에서만 보되 되돌리기 어려운 판단은 늘 멈춘다
   */
  static stops(mode: ChatStopMode, note: DecisionNoteRow): boolean {
    if (note.confirm === DecisionNote.IRREVERSIBLE) return true;
    if (mode === 'all') return true;
    if (mode === 'confirm') return note.confirm !== null;
    return false;
  }

  /** 답을 기다리는 기한. 되돌리기 어려운 판단은 기한이 없다 (null) */
  static expiresAt(note: DecisionNoteRow, now: Date): Date | null {
    if (note.confirm === DecisionNote.IRREVERSIBLE) return null;
    return new Date(now.getTime() + note.wait_minutes * 60_000);
  }
}
