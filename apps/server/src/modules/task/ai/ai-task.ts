import { randomUUID } from 'node:crypto';
import { Task } from '../task/task';
import { TaskSignin } from '../task/task-signin';

// AI 로그인이 여는 일 (연결 확인 · 웹 로그인). 에이전트도 작업 토큰도 없이 러너가 바로 돌고 (Task.AGENTLESS, request_id는 한 번 쓰는 값),
// 쌓인 일보다 먼저 돈다. 커넥터 확인(ExternalTool.checkTask)도 같은 우선순위를 쓴다
export class AiTasks {
  /** 쌓인 일보다 먼저 */
  static readonly PRIORITY = 1000;
  private static readonly TEST_PROMPT = 'ok라고만 답하세요.';

  /**
   * 웹 AI 로그인 (tool: claude · codex). 러너가 로그인 명령을 PTY 안에서 돌리고 주소를 알린다.
   * Claude는 사람이 브라우저의 코드를 붙여 넣어야 하고, Codex는 주소와 코드만 보여 주면 된다
   */
  static signin(spaceId: string, tool: string, now: Date): Task {
    const fields = {
      kind: Task.AI_SIGNIN,
      title: `${tool} 로그인`,
      payload: TaskSignin.start(tool),
      priority: AiTasks.PRIORITY,
    };
    return Task.open(spaceId, randomUUID(), fields, now);
  }

  /** AI 로그인의 연결 확인. 어느 판의 로그인을 보는지 함께 적어 둔다 */
  static test(spaceId: string, tool: string, loginVersion: number, now: Date): Task {
    const fields = {
      kind: Task.AI_TEST,
      title: 'AI 연결 확인',
      instruction: AiTasks.TEST_PROMPT,
      payload: { tool, loginVersion },
      priority: AiTasks.PRIORITY,
    };
    return Task.open(spaceId, randomUUID(), fields, now);
  }
}
