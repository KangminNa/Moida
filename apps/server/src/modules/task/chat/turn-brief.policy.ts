import { Actor, Forbidden, RuleViolation } from '../../platform';

/** 목표 확인 질문 하나: 물음 · 왜 묻는지 · 고를 답(없으면 글로) · 대표의 추천 답 */
export interface TurnBriefQuestion {
  text: string;
  why: string;
  choices: string[];
  suggested: string;
}

/** 회차 작업의 payload.chat.brief: 대표가 이해한 목표 한 줄과 질문들 */
export interface TurnBriefRow {
  summary: string;
  questions: TurnBriefQuestion[];
}

/** payload.chat의 칸 가운데 목표 확인이 보는 것 */
type TurnChat = {
  chatId?: unknown;
  requestId?: unknown;
  reply?: unknown;
  review?: unknown;
  fix?: unknown;
  brief?: unknown;
};

// 목표 확인 질문 (기획서 결정 2026-11-20, ECC의 /plan: 요구를 다시 말하고 확인을 받은 뒤에 만든다): 결과물을 맡기는
// 새 회차에서 대표가 품질을 가를 핵심(독자 · 범위 · 기준 · 형식 · 참고)이 빠졌으면 MCP ask_brief로 먼저 묻고 그 회차를 끝낸다.
// 관리자가 대화의 질문 카드에서 답하면(추천대로 · 고르기 · 글) 그 답이 다음 회차의 메시지가 되고, 대표는 그 답으로
// 방안(set_plan의 단계 · 완료 조건 · 하지 말 것)을 세워 맡긴다. 관리자가 답한 것이 완료 조건의 위다 (원칙 3).
// 묻지 않는 회차: 덧붙인 말의 답 · 검토 · 서버가 다시 맡긴 회차 · 자동화 회차(중간에 물을 사람이 없다) · 질문에 답한 회차(연달아 묻지 않음).
// 물은 회차는 받을 것을 검사하지 않고(TurnDeliver.effective), 답을 받기 전에는 팀에 맡기지 않는다(DelegationPolicy). 상태 없음
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. ChatUpdateService · TurnDeliver · DelegationPolicy가 쓴다
export class TurnBrief {
  static readonly QUESTIONS_MAX = 5;
  static readonly CHOICES_MAX = 4;
  static readonly SUMMARY_MAX = 300;
  static readonly TEXT_MAX = 200;
  static readonly CHOICE_MAX = 80;
  /** 자동화(스케줄 레시피)가 보낸 회차의 요청 접두어 (ScheduleService) */
  private static readonly SCHEDULE_PREFIX = 'schedule:';

  /**
   * 질문을 적은 새 payload. 대표의 대화 회차가 아니면 Forbidden, 물을 수 없는 회차 · 이미 물음 · 앞 회차가 물었음이면
   * RuleViolation. previousAsked: 바로 앞 회차가 질문한 회차인가 (이 회차가 그 답이다)
   */
  static declare(
    payload: Readonly<Record<string, unknown>>,
    brief: TurnBriefRow,
    previousAsked: boolean,
  ): Record<string, unknown> {
    const chat = (payload.chat ?? null) as TurnChat | null;
    if (typeof chat?.chatId !== 'string' || chat.reply === true || chat.review === true)
      throw new Forbidden(Actor.AGENT, '대화 회차를 맡은 대표만 물어요');
    if (chat.fix === true) throw new RuleViolation('서버가 다시 맡긴 회차에서는 묻지 않아요');
    if (String(chat.requestId ?? '').startsWith(TurnBrief.SCHEDULE_PREFIX))
      throw new RuleViolation('자동화 회차에서는 묻지 않아요 (답할 사람이 없어요)');
    if (chat.brief !== undefined) throw new RuleViolation('이번 회차에서 이미 물었어요');
    if (previousAsked)
      throw new RuleViolation('질문에 답한 회차예요. 받은 답으로 계획을 세워 진행해요');
    if (brief.questions.length === 0) throw new RuleViolation('질문을 하나 이상 적어요');
    return { ...payload, chat: { ...chat, brief } };
  }

  /** 이 회차가 목표 확인 질문을 했는가 (회차 작업의 payload) */
  static asked(payload: unknown): boolean {
    const chat = ((payload ?? {}) as { chat?: TurnChat }).chat;
    return typeof chat?.brief === 'object' && chat.brief !== null;
  }

  /** 대화 소식 한 줄 (question) */
  static news(brief: TurnBriefRow): string {
    return `목표를 확인할 것 ${brief.questions.length}개를 물었어요: ${brief.summary}`;
  }
}
