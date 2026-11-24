import type { Agent } from '../agent/agent';
import { Approval } from '../approval/approval';
import type { Task } from '../task/task';
import type { ApiCall } from './api-call';
import { ApiConnector } from './api-connector';
import type { ApiOperation } from './api-operation.policy';
import type { ApiSpec } from './api-spec.policy';

// API 커넥터의 결재를 여는 곳 (2026-11-24): 서버가 올린다 (request_approval로는 올리지 못한다, SERVER_ONLY).
//   task.api.plug: 새 커넥터 · 새 버전 정의서. 카드에 출처 · 기본 주소 · 동작(성격)을 싣는다
//   task.api.call: 쓰기 동작이거나 하루 한도를 넘은 부르기 한 번. 카드에 동작 · 입력을 싣는다
// 결재를 올린 작업은 기다리고(Approval.request), 승인되면 같은 작업이 이어서 한다 (task.api_call.ran의 continue)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 결재 만들기 한 곳
export class ApiApproval {
  /** request_approval로 올리지 못하는 동작 (서버가 내용을 확인해 올린다) */
  static readonly SERVER_ONLY: readonly string[] = [ApiConnector.PLUG, 'task.api.call'];
  private static readonly INPUT_MAX = 2000;

  static plug(
    task: Task,
    agent: Agent,
    connector: ApiConnector,
    spec: ApiSpec,
    note: string,
    now: Date,
    chatId: string | null,
  ): Approval {
    return Approval.request(
      task,
      agent,
      {
        action: ApiConnector.PLUG,
        target_kind: ApiConnector.TARGET,
        target_id: connector.id,
        target_version: connector.version,
        note: ApiApproval.plugNote(connector, spec, note),
      },
      now,
      chatId,
      {
        connector: connector.name,
        revision: !connector.proposed,
        base: spec.base,
        keys: spec.headers.map((h) => h.name),
        operations: spec.operations.map((o) => ({
          name: o.name,
          title: o.title,
          effect: o.effect,
        })),
      },
    );
  }

  static call(
    task: Task,
    agent: Agent,
    connector: ApiConnector,
    call: ApiCall,
    op: ApiOperation,
    now: Date,
    chatId: string | null,
  ): Approval {
    const reason =
      call.heldReason === 'write'
        ? '바깥에 남기는 동작'
        : `하루 한도 ${connector.dailyMax}번을 넘음`;
    return Approval.request(
      task,
      agent,
      {
        action: 'task.api.call',
        target_kind: 'api_call',
        target_id: call.id,
        target_version: 1,
        note: `${connector.name} · ${op.title} (${reason})\n입력: ${ApiApproval.clip(JSON.stringify(call.input))}`,
      },
      now,
      chatId,
      {
        connector: connector.name,
        operation: op.name,
        title: op.title,
        effect: op.effect,
        reason: call.heldReason,
        input: ApiApproval.clip(JSON.stringify(call.input)),
      },
    );
  }

  /** 카드에 보이는 글: 무엇을 어디에 붙이는지 · 동작마다 성격 · 키를 넣을 머리글 */
  private static plugNote(connector: ApiConnector, spec: ApiSpec, note: string): string {
    const effect = {
      read: '조회',
      spend: '돈이 듦 · 하루 한도',
      write: '바깥에 남김 · 부를 때마다 승인',
    };
    return [
      `${connector.proposed ? 'API 커넥터 붙이기' : 'API 커넥터 새 버전'}: ${connector.name}${note ? ` (${note})` : ''}`,
      `주소: ${spec.base}`,
      `동작: ${spec.operations.map((o) => `${o.title}(${effect[o.effect]})`).join(' · ')}`,
      spec.headers.length
        ? `키를 넣을 머리글: ${spec.headers.map((h) => h.name).join(' · ')} (승인 뒤 커넥터 화면에서)`
        : '키 없음',
    ].join('\n');
  }

  private static clip(text: string): string {
    return text.length > ApiApproval.INPUT_MAX ? `${text.slice(0, ApiApproval.INPUT_MAX)}…` : text;
  }
}
