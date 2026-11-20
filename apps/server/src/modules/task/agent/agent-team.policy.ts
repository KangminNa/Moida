import { RuleViolation } from '../../platform';
import type { AgentTeamMemberRow, AgentTeamRow } from './agent.view';
import app from './teams/app.json';
import base from './teams/base.json';
import blog from './teams/blog.json';
import briefing from './teams/briefing.json';
import code from './teams/code.json';
import contest from './teams/contest.json';
import data from './teams/data.json';
import maintainer from './teams/maintainer.json';
import output from './teams/output.json';
import planning from './teams/planning.json';
import tidy from './teams/tidy.json';

/** 팀 정의 파일(teams/<key>.json)의 모양: 역할은 줄 목록이다 (읽을 때 한 글로 잇는다) */
interface AgentTeamFile extends Omit<AgentTeamRow, 'members'> {
  members: (Omit<AgentTeamMemberRow, 'role'> & { role: string[] })[];
}

// 에이전트 팀 템플릿 (기획서 결정 2026-11-14). 버튼 한 번에 역할 · 권한 · 조직도가 정해진 팀을 만든다.
// 팀마다 정의 파일 하나(teams/<key>.json, 2026-11-20 ECC형 에이전트 정의: ECC의 agents/*.md처럼 코드 밖에 둔다).
// 늘리려면 파일을 하나 더하고 아래 목록에 넣는다. 화면의 순서가 이 목록의 순서다 (기본 팀이 맨 앞).
// 구성원의 역할은 표준 형식(AgentRole: 첫 줄 언제 맡기나 + 단락 다섯, 1500자 안), 권한 이름은 agents.scopes의 값이다
// (agent-role.policy.test · agent-team.policy.test가 본다). 관리자가 고치는 템플릿이 필요해지면 이 자리를 표로 바꾼다.
// 구성원의 reports_to는 같은 템플릿 안의 key, null이면 관리자에게. 권한은 Agent의 규칙을 그대로 지난다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 템플릿 목록 한 곳. 서비스 · 읽기 · 테스트가 함께 쓴다
export class AgentTeams {
  /** 앱 운영 팀 (teams/app.json): 대화의 앱 만들기가 new_team으로 부른다 (스토어 2-6) */
  static readonly APP = 'app';
  private static readonly FILES = [
    base,
    contest,
    briefing,
    planning,
    output,
    data,
    code,
    tidy,
    maintainer,
    blog,
    app,
  ] as readonly AgentTeamFile[];
  static readonly ALL: readonly AgentTeamRow[] = AgentTeams.FILES.map((team) => ({
    ...team,
    members: team.members.map((m) => ({ ...m, role: m.role.join('\n') })),
  }));

  /** key의 템플릿. 없으면 422 */
  static of(key: string): AgentTeamRow {
    const team = AgentTeams.ALL.find((t) => t.key === key);
    if (!team) throw new RuleViolation(`없는 팀 템플릿이에요: ${key}`);
    return team;
  }
}
