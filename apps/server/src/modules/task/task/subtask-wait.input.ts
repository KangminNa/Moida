import { BaseRequest } from '../../platform';
import { SubtaskWait } from './subtask-wait.policy';

/**
 * MCP wait_subtasks (팀원 기다리기, 2026-11-19): 먼저 깨어난 위 작업이 끝나지 않은 하위 작업을 더 기다린다.
 * minutes: 기한(분, 없으면 SubtaskWait의 기본값). cancel: 기다리지 않고 취소할 바로 아래 하위 작업 id (10개까지)
 */
export class WaitSubtasksInput extends BaseRequest {
  private static readonly CANCEL_MAX = 10;
  private static readonly ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private constructor(
    readonly minutes: number | null,
    readonly cancel: readonly string[],
  ) {
    super();
  }

  static from(raw: unknown): WaitSubtasksInput {
    return BaseRequest.read(raw, (f) => {
      const cancel = f.optionalTextList('cancel', WaitSubtasksInput.CANCEL_MAX, 36) ?? [];
      if (cancel.some((id) => !WaitSubtasksInput.ID.test(id)))
        f.reject('cancel', '하위 작업 id(uuid)의 목록이에요');
      return new WaitSubtasksInput(
        f.optionalInteger('minutes', 1, SubtaskWait.MINUTES_MAX),
        cancel.map((id) => id.toLowerCase()),
      );
    });
  }
}

/** MCP ask_help (2026-11-20): 나눠 맡길 부분 (무엇을 · 어디까지 · 받을 결과) */
export class AskHelpInput extends BaseRequest {
  private constructor(readonly part: string) {
    super();
  }

  static from(raw: unknown): AskHelpInput {
    return BaseRequest.read(
      raw,
      (f) => new AskHelpInput(f.text('part', SubtaskWait.HELP_TEXT_MAX)),
    );
  }
}
