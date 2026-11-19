// 대화의 일을 찾는 request_id (작업 쪽에 대화를 가리키는 칸을 두지 않아서 이름으로 찾는다. 목표 실행과 같다):
//   회차 chat:<대화>:<회차>, 그 덧붙인 말의 답 …:reply:<n>, 검토 …:review.
// O-2 전의 배정 일은 chat-route:<대화>:<id>였다 (대화의 토큰 합계에만 남는다). chat: 로 시작하지 않아 대화의 일 규칙에 섞이지 않는다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 이름 규칙 한 곳. Chat · Repository · Query가 함께 쓴다
export class ChatRequest {
  /** 회차 작업의 맨 앞 (SQL이 대화 id · 회차를 이어 붙인다) */
  static readonly TURN_PREFIX = 'chat:';
  /**
   * 대화의 일(회차 · 덧붙인 말의 답 · 검토)의 대기열 우선순위 (팀원 기다리기, 2026-11-19): 관리자가 기다리는 일이라
   * 스케줄 · 목표의 배경 일(0)보다 먼저 빌려 준다. 하위 작업은 위 작업의 우선순위를 물려받는다
   */
  static readonly PRIORITY = 10;
  /** O-2 전 배정 일의 맨 앞 (대화의 토큰 합계에만, SQL이 대화 id를 이어 붙인다) */
  static readonly ROUTE_PREFIX = 'chat-route:';

  /** 회차 작업 */
  static turn(chatId: string, turn: number): string {
    return `${ChatRequest.TURN_PREFIX}${chatId}:${turn}`;
  }

  /** 회차의 결과를 결재 전에 검토하는 작업 (검토자 짝, 2차 2단계) */
  static review(chatId: string, turn: number): string {
    return `${ChatRequest.turn(chatId, turn)}:review`;
  }

  /** from회차부터 to회차까지 (작업을 찾는 데 쓴다) */
  static turns(chatId: string, from: number, to: number): string[] {
    const ids: string[] = [];
    for (let turn = Math.max(1, from); turn <= to; turn++) ids.push(ChatRequest.turn(chatId, turn));
    return ids;
  }

  /** 이 대화의 O-2 전 배정 일들의 앞부분 (토큰 합계) */
  static route(chatId: string): string {
    return `${ChatRequest.ROUTE_PREFIX}${chatId}:`;
  }
}
