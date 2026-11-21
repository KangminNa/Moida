import { BaseRequest, type RequestFields } from '../../platform';
import type { TaskNew } from '../task.tables';

/** 대상의 판(target_version) 위쪽 끝 (Postgres integer) */
const VERSION_MAX = 2_147_483_647;

/** delegate_task의 하위 작업 하나. 받는 에이전트와 일의 뜻(종류, 권한)은 Task.subtask가 검사한다 */
export class SubtaskOrder extends BaseRequest {
  /** 모양만 넉넉히 막는다. 개수 · 길이 · 위 작업 안인지는 도메인(CodeScope)이 본다 */
  private static readonly PATHS_SHAPE = 40;
  private static readonly PATH_SHAPE = 1_000;
  private static readonly REFS_SHAPE = 10;
  private static readonly REF_SHAPE = 2_000;
  static readonly DELIVER_MAX = 300;
  static readonly AFTER_MAX = 4;

  private constructor(
    readonly requestId: string,
    readonly toAgentId: string,
    /** MCP 입력은 칸 이름 그대로다. 대상의 판(base_version)만 target_version으로 받는다 */
    readonly fields: Omit<TaskNew, 'id' | 'space_id'>,
    /** code 일의 고칠 수 있는 곳 (위 code 작업의 경로 안). 다른 일에는 없다 */
    readonly paths: readonly string[] | null,
    /** 넘길 참조: 위 작업의 참조 가운데 id나 주소 (TaskRefs.handOn이 고른다) */
    readonly refs: readonly string[] | null,
    /** 받을 것: 하위 작업이 돌려줄 결과의 형식 (D1, 2026-11-17). 하위 작업의 deliver, 위 작업의 subtask_results[].deliver */
    readonly deliver: string | null,
    /** make 일의 결과를 이 앱 코드의 새 버전으로 (payload.appCode, 스토어 1-6b). 다른 일에는 없다 */
    readonly appId: string | null,
    /** 이 일의 모델 (haiku · sonnet · opus, 맡기는 일의 모델 이하, ModelTier). 없으면 팀원의 설정 */
    readonly model: string | null,
    /** 앞 단계 (D2, 2026-11-21): 같은 호출의 앞 하위 작업 request_id. 그것들이 끝나면 서버가 이 일을 시작한다 (SubtaskAfter) */
    readonly after: readonly string[],
    /** 받은 모양 그대로 (after가 있으면 위 작업에 적어 두었다가 그대로 다시 읽는다, SubtaskOrder.saved) */
    readonly raw: Readonly<Record<string, unknown>>,
  ) {
    super();
  }

  /** 위 작업에 적어 둔 하위 작업을 다시 읽는다 (앞 단계가 끝났을 때) */
  static saved(raw: unknown): SubtaskOrder {
    return BaseRequest.read({ order: raw }, (f) => SubtaskOrder.from(f.nested('order'), raw));
  }

  static from(f: RequestFields, raw: unknown): SubtaskOrder {
    const targetKind = f.optionalText('target_kind', 40);
    return new SubtaskOrder(
      f.text('request_id', 200),
      f.uuid('to_agent_id'),
      {
        kind: f.optionalText('kind', 100) ?? 'general',
        title: f.text('title', 200),
        instruction: f.text('instruction', 20_000),
        target_kind: targetKind,
        target_id: targetKind === null ? null : f.uuid('target_id'),
        base_version:
          targetKind === null ? null : f.optionalInteger('target_version', 0, VERSION_MAX),
      },
      f.optionalTextList('paths', SubtaskOrder.PATHS_SHAPE, SubtaskOrder.PATH_SHAPE),
      f.optionalTextList('refs', SubtaskOrder.REFS_SHAPE, SubtaskOrder.REF_SHAPE),
      f.optionalText('deliver', SubtaskOrder.DELIVER_MAX),
      f.optionalText('app_id', 36) === null ? null : f.uuid('app_id'),
      f.optionalText('model', 20),
      f.optionalTextList('after', SubtaskOrder.AFTER_MAX, 200) ?? [],
      (raw ?? {}) as Record<string, unknown>,
    );
  }
}
