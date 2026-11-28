import { RuleViolation } from '../../platform';
import { DecisionNote, type DecisionNoteRow } from '../chat/decision-note.policy';
import type { Task } from '../task/task';

/** 판단 승인의 payload (승인 요청에 실린다): 판단 한 줄 · 고른 안(추천안) · 다른 안 · 까닭 · 확인 필요의 까닭 · 대화 */
interface DecisionAskRow {
  text: string;
  chosen: string;
  alternatives: string[];
  why: string;
  confirm: string | null;
  chatId: string;
  /** 정해진 뒤: 고른 안. 고쳐 말하기 · 반려면 없다 */
  picked?: string;
}

// 확인 필요 판단 (L3, 2026-11-28): 일꾼이 post_update의 decision에 confirm을 적고 대화의 멈춤 기준이 멈추라고 하면
// (DecisionNote.stops) 고를 안이 있는 승인(task.decision)이 되고 일은 승인을 기다린다. 대상은 그 작업 자신이다.
//   고르기(승인 + choice): 0은 일꾼이 고른 안(추천안), 1~은 다른 안. 일은 그 안을 받아 다시 대기열로
//   고쳐 말하기(revise): 관리자의 말을 받아 다시 대기열로. 반려: 일을 멈춘다
//   기한(expires_at)이 지나면 서버가 추천안으로 승인한다 (agent_decided). 되돌리기 어려운 판단은 기한이 없다
// 답은 작업 payload의 decided로 넘긴다 (러너의 지시문 틀 decided). 상태 없음
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Approval · ChatUpdateService가 쓴다
export class DecisionAsk {
  static readonly ACTION = 'task.decision';
  static readonly TARGET = 'task';
  static readonly LAPSED = '기한이 지나 추천안으로 이어서 해요';

  /** 승인 요청 (Approval.request에 넘길 칸 · payload)과 기한 (Approval.expireAt) */
  static request(task: Task, text: string, note: DecisionNoteRow, chatId: string, now: Date) {
    const { chosen, alternatives, why, confirm } = note;
    const payload: DecisionAskRow = { text, chosen, alternatives, why, confirm, chatId };
    return {
      fields: {
        action: DecisionAsk.ACTION,
        target_kind: DecisionAsk.TARGET,
        target_id: task.id,
        target_version: task.version,
        note: text,
      },
      payload: { ...payload },
      expiresAt: DecisionNote.expiresAt(note, now),
    };
  }

  /** 고른 안을 적은 payload. choice가 없으면 추천안 (0 추천안, 1~ 다른 안) */
  static picked(payload: unknown, choice: number | null): DecisionAskRow {
    const p = payload as DecisionAskRow;
    const options = [p.chosen, ...(p.alternatives ?? [])];
    const at = choice ?? 0;
    if (at < 0 || at >= options.length)
      throw new RuleViolation(`고를 안은 0~${options.length - 1} 중 하나예요`);
    return { ...p, picked: options[at] };
  }

  /**
   * 정해진 판단을 작업 payload에 넘긴다 (Task.declare). picked가 없으면 고쳐 말한 것.
   * note: 승인의 메모 (결정하며 남긴 말이 없으면 판단 한 줄 그대로라 넘기지 않는다). lapsed: 기한이 지나 서버가 정했다
   */
  static answered(
    payload: unknown,
    note: string | null,
    lapsed: boolean,
  ): (task: Readonly<Record<string, unknown>>) => Record<string, unknown> {
    const p = payload as DecisionAskRow;
    const said = note === p.text || note === DecisionAsk.LAPSED ? null : note;
    return (task) => ({
      ...task,
      decided: { text: p.text, chosen: p.chosen, picked: p.picked ?? null, note: said, lapsed },
    });
  }
}
