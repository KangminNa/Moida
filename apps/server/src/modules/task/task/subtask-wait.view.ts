// 팀원 기다리기의 MCP 답 (2026-11-20). 웹이 쓰지 않는다

/**
 * ask_help의 답 (MCP라 snake_case). lead_woken: 하위 작업을 기다리던 팀장을 깨웠다 (그 부분은 팀장이 다른 팀원에게 맡긴다).
 * false면 팀장이 기다리는 중이 아니라 나눌 부분도 직접 이어서 한다
 */
export class HelpAskedView {
  constructor(private readonly leadWoken: boolean) {}

  toJSON() {
    return { asked: true, lead_woken: this.leadWoken };
  }
}
