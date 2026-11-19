import { ExternalMcp } from './external-mcp';
import { Json } from './json';

/**
 * 에이전트가 정한 AI CLI의 런타임 (2차 7단계): 모델 · 생각 강도(빈 글이면 CLI의 기본값), 허락한 외부 도구.
 * 서버가 이미 거른 값이지만 설정 파일 · 인자에 그대로 쓰므로 여기서도 모양을 다시 본다: 모양이 틀리면 기본값으로 돈다.
 * 도구가 받는 강도의 목록은 어댑터가 안다 (Claude --effort, Codex model_reasoning_effort).
 */
export class CliRuntime {
  static readonly NONE = new CliRuntime('', '', []);
  /** 모델 이름의 글자 (서버 AgentRuntime.MODEL과 같다): 따옴표 · 공백 · 줄바꿈이 설정 파일에 들어가지 않게 */
  private static readonly MODEL = /^[A-Za-z0-9._[\]-]{1,80}$/;
  private static readonly EFFORT = /^[a-z]{1,10}$/;
  /** 쓰지 않는 모델 (서버 AgentRuntime.BLOCKED와 같다, 2026-11-19): Fable 계열. best는 이 이미지의 Claude Code에서 Fable */
  private static readonly BLOCKED = /fable|^best$/i;

  private constructor(
    readonly model: string,
    readonly effort: string,
    /** 이 에이전트에게 허락한 외부 도구. 셸이 있는 칸의 일에는 어댑터가 붙이지 않는다 */
    readonly tools: readonly ExternalMcp[],
  ) {}

  /** next_jobs의 agent · tools 칸에서. 옛 서버면 칸이 없어 기본값 */
  static from(agent: Json = Json.of({}), tools: readonly Json[] = []): CliRuntime {
    const model = agent.text('model');
    const effort = agent.text('effort');
    return new CliRuntime(
      CliRuntime.MODEL.test(model) ? model : '',
      CliRuntime.EFFORT.test(effort) ? effort : '',
      ExternalMcp.list(tools),
    );
  }

  /** 쓰지 않는 모델이면 그 까닭 (일을 돌지 않고 실패로 낸다: 옛 서버나 그 전에 저장된 값). 아니면 null */
  get refusal(): string | null {
    return CliRuntime.BLOCKED.test(this.model)
      ? `Fable 모델(${this.model})은 쓰지 않아요. 에이전트 · 대화의 모델을 opus · sonnet · haiku 가운데로 바꿔 주세요`
      : null;
  }

  /** 로그와 기록에서 지울 값 (외부 도구의 머리글 값) */
  get secrets(): readonly string[] {
    return this.tools.flatMap((t) => t.secrets);
  }
}
