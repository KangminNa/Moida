import { SubtaskAfter } from '../task/subtask-after.policy';
import { Task } from '../task/task';
import type { TaskRow } from '../task.tables';
import type { ChatSaid } from './chat-update.policy';

/** 나눠 맡긴 하위 작업 한 줄과 받은 일꾼의 이름 (ChatRepository.planOf) */
export type PlanChildRow = Pick<TaskRow, 'title' | 'agent_id'> & { agent_name: string | null };

// 위임을 계획 판단으로 보이기 (D3, 2026-11-28): 대화의 일이 하위 작업을 기다리기 시작하면 무엇을 누구에게 맡겼는지를
// 맡긴 에이전트의 판단 소식(Chat.post의 kind decision, 모양은 DecisionNote에 plan · planned를 더함)으로 남긴다.
// 서버가 남기니 post_update의 한도는 보지 않는다 (이 소식도 그 작업의 개수에는 든다). 관리자는 L1의 "바꾸기"로 고쳐 말한다.
// 앞 계획 뒤로 새로 맡긴 것이 없으면(더 기다리기) 남기지 않는다. 글은 제목 · 이름만 잇는다 (설명 문장을 덧붙이지 않는다). 상태 없음
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. ChatUpdateService가 쓴다
export class ChatPlan {
  static readonly KIND = 'decision';
  static readonly STEP = '나눠 맡기기';
  private static readonly SHOWN = 10;

  /**
   * 위 작업(parent)이 하위 작업을 기다리는 중일 때의 계획: 만든 하위 작업(children) + 앞 단계를 기다리는 것(payload.afterOrders).
   * noted: 앞 계획 소식에 실린 수. 새로 맡긴 것이 없으면 null
   */
  static line(
    parent: Pick<TaskRow, 'status' | 'wait_reason' | 'payload'>,
    children: readonly PlanChildRow[],
    names: ReadonlyMap<string, string>,
    noted: number,
  ): ChatSaid | null {
    if (parent.status !== Task.WAITING || parent.wait_reason !== Task.WAIT_SUBTASKS) return null;
    const later = SubtaskAfter.held(parent.payload).map((held) => {
      const order = (held.order ?? {}) as { title?: unknown; to_agent_id?: unknown };
      return {
        title: String(order.title ?? ''),
        agent: names.get(String(order.to_agent_id ?? '')) ?? null,
        after: true,
      };
    });
    const plan = [
      ...children.map((c) => ({ title: c.title, agent: c.agent_name, after: false })),
      ...later,
    ];
    if (plan.length <= noted) return null;
    const chosen = plan
      .slice(0, ChatPlan.SHOWN)
      .map((p) => `${p.title} → ${p.agent ?? '-'}${p.after ? ' (앞 단계 뒤)' : ''}`)
      .join(' · ');
    return {
      text: `일 ${plan.length}개를 나눠 맡김`,
      data: {
        chosen: chosen.slice(0, 300),
        alternatives: [],
        why: '',
        weight: 'low',
        step: ChatPlan.STEP,
        plan,
        planned: plan.length,
      },
    };
  }
}
