import { DomainEvent, RuleViolation } from '../../platform';
import type { OutputRow, TaskRow } from '../task.tables';

// 만들기 작업의 결과를 앱 코드의 새 버전으로 내라는 주문 (payload.appCode, 스토어 1-6, docs/스토어.md 9.6).
// 작업이 끝나면 이번 실행의 결과물 묶음을 이벤트(task.app_code.built)로 알리고, 앱을 가진 모듈(blog)이 앞 버전 위에 얹어
// 새 버전으로 쌓는다. task는 공개하지 않는다: 무엇을 만들었는지만 알린다 (공개 앱의 새 버전은 관리자가 확인한 뒤 공개).
// 바꾼 파일만 내도 된다. 크기가 한도를 넘으면 버전이 될 수 없어 작업을 실패로 끝낸다 (나머지 규칙은 blog가 본다).
export class AppCodeOrder {
  static readonly BUILT = 'task.app_code.built';
  /** 버전 하나의 파일 수 · 크기 합 · 템플릿(.html) 크기 합 (blog의 AppCodeBundle과 같은 한도) */
  static readonly FILES_MAX = 100;
  private static readonly BYTES_MAX = 20 * 1024 * 1024;
  private static readonly TEMPLATE_BYTES_MAX = 1024 * 1024;
  private static readonly TEMPLATE = /\.html$/i;
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  private constructor(
    /** 고칠 앱 (blog의 것, 값) */
    readonly appId: string,
  ) {}

  /** 이 결과물 묶음을 앱 코드로 낼 수 없는 까닭. 낼 수 있으면 null */
  refusal(outputs: readonly OutputRow[]): string | null {
    if (outputs.length === 0) return '앱 코드로 낼 파일이 없어요';
    if (outputs.length > AppCodeOrder.FILES_MAX)
      return `앱 코드의 파일은 ${AppCodeOrder.FILES_MAX}개까지예요 (지금 ${outputs.length}개)`;
    const bytes = outputs.reduce((sum, o) => sum + Number(o.size_bytes), 0);
    if (bytes > AppCodeOrder.BYTES_MAX) return '앱 코드는 합쳐 20MB까지예요';
    const templates = outputs
      .filter((o) => AppCodeOrder.TEMPLATE.test(o.name))
      .reduce((sum, o) => sum + Number(o.size_bytes), 0);
    if (templates > AppCodeOrder.TEMPLATE_BYTES_MAX) return '템플릿(.html)은 합쳐 1MB까지예요';
    return null;
  }

  /** 끝난 작업의 결과물 묶음을 알리는 이벤트. 버전으로 쌓는 것은 앱을 가진 모듈이 한다 */
  built(task: TaskRow, outputs: readonly OutputRow[]): DomainEvent {
    return new DomainEvent(AppCodeOrder.BUILT, 1, task.space_id, {
      taskId: task.id,
      runId: outputs[0]?.run_id ?? null,
      appId: this.appId,
      note: task.instruction ?? '',
      files: outputs.map((o) => ({
        name: o.name,
        blobHash: o.blob_hash,
        mime: o.mime,
        sizeBytes: Number(o.size_bytes),
      })),
    });
  }

  /** payload의 appCode에서. 없으면 null, 모양이 틀리면 RuleViolation */
  static of(payload: unknown): AppCodeOrder | null {
    const order = (payload as { appCode?: unknown } | null)?.appCode;
    if (order === undefined || order === null) return null;
    const appId = (order as { appId?: unknown } | null)?.appId;
    if (typeof order !== 'object' || typeof appId !== 'string' || !AppCodeOrder.UUID.test(appId))
      throw new RuleViolation('앱 코드(appCode)는 고칠 앱의 appId를 담은 객체예요');
    return new AppCodeOrder(appId);
  }
}
