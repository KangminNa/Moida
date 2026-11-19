import type { AdminApp } from '../../_blog/types';
import type { Agent } from '../../_task/types';

// 앱의 운영 팀 (스토어 2단계): 화면이 에이전트 목록에서 고르는 규칙. 서버의 판단(blog AppTeam)과 같은 조건이고,
// 맞지 않는 것을 보내면 서버가 422로 막는다 (여기는 고를 수 있는 것만 보여 주는 쪽).

/** 앱의 운영 팀장이 될 수 있는 에이전트: 맨 위(대표가 맡기는 층) · 휴지통 밖 · 비공개를 읽지 않음 */
export function teamLeaders(agents: readonly Agent[]): Agent[] {
  return agents.filter(
    (a) => a.reportsTo === null && a.deletedAt === null && !a.scopes.includes('read_all'),
  );
}

/** 팀장 아래 팀 전체 (손자 팀까지, 휴지통 밖). 위에서부터, depth는 팀장 바로 아래가 1 */
export function teamUnder(
  agents: readonly Agent[],
  leaderId: string,
): { agent: Agent; depth: number }[] {
  const live = agents.filter((a) => a.deletedAt === null);
  const out: { agent: Agent; depth: number }[] = [];
  const visit = (boss: string, depth: number) => {
    for (const agent of live)
      if (agent.reportsTo === boss) {
        out.push({ agent, depth });
        visit(agent.id, depth + 1);
      }
  };
  visit(leaderId, 1);
  return out;
}

/**
 * 고르기 칸의 이름: 같은 템플릿으로 만든 팀장은 이름이 같아서(편집장) 이미 운영하는 앱을 붙여 가른다.
 * except: 지금 고치는 앱 (자기 앱은 붙이지 않는다)
 */
export function leaderLabel(
  agent: Agent,
  apps: readonly AdminApp[],
  except: string | null = null,
): string {
  const runs = apps.filter((a) => a.agentId === agent.id && a.id !== except).map((a) => a.name);
  return runs.length > 0 ? `${agent.name} · ${runs.join(', ')} 운영` : agent.name;
}

/** 앱 운영 팀 템플릿의 키 (서버 writing-teams.ts) */
export const APP_TEAM_TEMPLATE = 'app';
