import {
  Actor,
  NotFound,
  Read,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { DelegationGuardedView } from './click-views';
import { integrations, sites } from './schema';

// 위임 지킴이 (플러그인 API 0.9, 2026-11-21 사용자 결정 "배정 단계에서 사이트 도구 먼저"): 대표가 browser_site를 대상으로
// browse 일을 맡기면 코어가 먼저 여기를 부른다. 그 사이트에 켜진 사이트 도구가 있으면 브라우저 대신 도구를 쓰게 거절한다.
// 통과하는 길 둘:
//   · 그 대표가 최근 TRIED_MINUTES 안에 그 사이트의 도구를 불러 봤다 (runs: 실패했거나 모양이 안 맞아 브라우저가 필요해진 경우)
//   · 지시에 그 도구의 이름을 적었다 (도구로 할 수 없는 일: 사이트를 바꾸는 일 · 도구가 못 읽는 것. 왜 못 쓰는지 함께 적는다)
// 읽기만 하고(코어의 트랜잭션 밖), 거절은 RuleViolation의 글로 대표에게 돌아간다. 둘러보기(대상 없음)는 지킴이를 지나지 않는다

type GuardInput = { targetId: string; instruction: string; agentId: string };
const TRIED_MINUTES = 30;

export class GuardSiteDelegation extends Read<GuardInput> {
  readonly name = 'guardSiteDelegation';
  readonly allow = Actor.AGENT;

  input(raw: unknown): GuardInput {
    return this.fields(raw, (f) => ({
      targetId: f.uuid('target_id'),
      instruction: f.optionalText('instruction', 20_000) ?? '',
      agentId: f.uuid('agent_id'),
    }));
  }

  async run(work: Work, actor: Actor, input: GuardInput): Promise<DelegationGuardedView> {
    const space = actor.requireSpace();
    const site = await work.row(sites, { id: input.targetId, space_id: space });
    if (!site) throw new NotFound('없는 사이트예요 (browser_sites에서 골라요)');
    const tools = await work.rows(
      integrations,
      { site_id: site.id, space_id: space, status: 'on' },
      { order: ['name'] },
    );
    const names = tools.map((t) => t.name);
    if (tools.length === 0) return new DelegationGuardedView(names);
    const text = input.instruction.toLowerCase();
    if (names.some((name) => text.includes(name.toLowerCase())))
      return new DelegationGuardedView(names);
    const [tried] = await work.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM browser_tabs.runs
      WHERE agent_id = ${input.agentId} AND integration_id = ANY(${tools.map((t) => t.id)}::uuid[])
        AND created_at > now() - make_interval(mins => ${TRIED_MINUTES})`;
    if ((tried?.n ?? 0) > 0) return new DelegationGuardedView(names);
    const list = tools
      .map((t) => `${t.name}(${t.title}, ${t.mode === 'write' ? '쓰기' : '읽기'})`)
      .join(' · ');
    throw new RuleViolation(
      `${site.name}에는 켜진 사이트 도구가 있어요: ${list}. 브라우저로 맡기기 전에 site_run으로 먼저 해요 (AI 없이 몇 초). ` +
        '도구로 할 수 없는 일이면 지시에 그 도구 이름과 할 수 없는 까닭을 적어 다시 맡겨요',
    );
  }
}
