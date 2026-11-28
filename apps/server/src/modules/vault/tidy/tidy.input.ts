import { BaseRequest } from '../../platform';

const VERSION_MAX = 2_147_483_647;

/** PUT /api/tidy/settings { autoTidy, cadence?, version }. 행이 없을 때의 version은 0이다 */
export class SaveTidySettingsInput extends BaseRequest {
  private constructor(
    readonly autoTidy: boolean,
    /** 언제: save(저장할 때마다) · daily(하루 한 번). 보내지 않으면 그대로 (2차 7단계) */
    readonly cadence: string | null,
    readonly version: number,
  ) {
    super();
  }

  static from(raw: unknown): SaveTidySettingsInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new SaveTidySettingsInput(
          f.boolean('autoTidy'),
          f.optionalText('cadence', 10),
          f.integer('version', 0, VERSION_MAX),
        ),
    );
  }
}

/** vault.session.saved 이벤트의 내용 중 정리에 쓰는 칸 */
export class SessionSavedInput extends BaseRequest {
  private constructor(
    readonly sessionId: string,
    readonly seq: number,
  ) {
    super();
  }

  static from(data: unknown): SessionSavedInput {
    return BaseRequest.read(
      data,
      (f) => new SessionSavedInput(f.uuid('sessionId'), f.integer('seq', 1, VERSION_MAX)),
    );
  }
}

/**
 * 작업 세션의 요청이 끝났을지 모르는 이벤트 (S2): 끝난 작업(task.task.changed의 완료 · 실패 · 취소)이나
 * 정한 결재(task.approval.granted · rejected · cancelled, 결과 카드인지는 task가 본다). 그 밖의 상태는 id가 null
 */
export class FlowEventInput extends BaseRequest {
  static readonly TASK_CHANGED = 'task.task.changed';
  static readonly APPROVAL_TOPICS = [
    'task.approval.granted',
    'task.approval.rejected',
    'task.approval.cancelled',
  ] as const;
  private static readonly ENDED: readonly string[] = ['done', 'failed', 'cancelled'];

  private constructor(
    readonly id: string | null,
    /** id가 결재 (결과 카드)인가 */
    readonly card: boolean,
  ) {
    super();
  }

  static from(name: string, data: unknown): FlowEventInput {
    if (name !== FlowEventInput.TASK_CHANGED)
      return BaseRequest.read(data, (f) => new FlowEventInput(f.uuid('approvalId'), true));
    return BaseRequest.read(data, (f) => {
      const id = f.uuid('taskId');
      return new FlowEventInput(
        FlowEventInput.ENDED.includes(f.text('status', 20)) ? id : null,
        false,
      );
    });
  }
}
