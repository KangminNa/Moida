import type { AgentRow, TaskRow } from '../task.tables';
import type { AgentScoreRow } from '../usage/usage.view';

/** 주간 팀 점검에 싣는 에이전트 한 명과 함께 읽는 칸: 보고 대상 이름 · 쥔 일 */
export interface TeamReviewRow
  extends Pick<AgentRow, 'id' | 'name' | 'role' | 'tool' | 'model' | 'status'> {
  boss: string | null;
  open: number;
}

// 주간 팀 점검 (기획서 결정 2026-11-20, ECC의 harness-optimizer · agent-architecture-audit에서 가져옴): 지난 점검 뒤로
// GAP_DAYS일이 지났고 그동안 에이전트의 일이 MIN_DONE개 이상 끝났으면, 대표에게 성적표로 팀을 점검하는 일 하나를 맡긴다.
// 대표는 역할 설명 · 모델 · 쉬게 하기 · 에이전트 더하기를 propose_setting으로 제안하고, 관리자가 승인해야 바뀐다 (원칙 3).
// 숫자는 근거일 뿐 판정이 아니다: 판정이 적은 에이전트의 비율은 참고만 하라고 지시문에 적는다. 상태 없음
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. TaskService와 TeamReviewQuery가 쓴다
export class TeamReview {
  static readonly GAP_DAYS = 7;
  /** 그동안 끝난 에이전트의 일이 이보다 적으면 점검할 거리가 없다 */
  static readonly MIN_DONE = 10;
  static readonly PREFIX = 'team-review:';
  static readonly TITLE = '주간 팀 점검';
  /** 대화의 일(10)과 보통 일(0)보다 뒤 (배우기와 같다) */
  static readonly PRIORITY = -5;
  private static readonly DAY_MS = 86_400_000;
  private static readonly OPEN: readonly string[] = ['queued', 'running', 'waiting'];
  private static readonly ROLE_TEXT = 120;
  /** 지시문에 싣는 팀원 수 (일이 많은 순). 넘으면 지시문이 작업 지시의 한도(20,000자)를 넘는다 */
  static readonly MEMBERS_MAX = 30;

  /** 그동안의 일을 세기 시작하는 때: 지난 점검과 GAP_DAYS일 전 가운데 늦은 쪽 */
  static since(last: Pick<TaskRow, 'created_at'> | null, now: Date): Date {
    const gap = new Date(now.getTime() - TeamReview.GAP_DAYS * TeamReview.DAY_MS);
    return last && last.created_at > gap ? last.created_at : gap;
  }

  /**
   * 맡길 때인가: 열린 점검이 없고, 지난 점검(처음이면 대표가 생긴 때)이 GAP_DAYS일 전보다 오래됐고, 그동안 끝난 일이
   * MIN_DONE개 이상. 첫 점검도 팀이 일주일은 일한 뒤에 한다 (막 만든 팀은 숫자가 없다)
   */
  static due(
    last: Pick<TaskRow, 'status' | 'created_at'> | null,
    done: number,
    now: Date,
    leadSince: Date,
  ): boolean {
    if (last !== null && TeamReview.OPEN.includes(last.status)) return false;
    const from = last?.created_at ?? leadSince;
    if (now.getTime() - from.getTime() < TeamReview.GAP_DAYS * TeamReview.DAY_MS) return false;
    return done >= TeamReview.MIN_DONE;
  }

  /** 공간 · 날(UTC)마다 일 하나 (간격은 due가 지킨다) */
  static requestId(spaceId: string, now: Date): string {
    return `${TeamReview.PREFIX}${spaceId}:${now.toISOString().slice(0, 10)}`;
  }

  /** 지시문 틀 team-review의 자리: 팀원마다 두 줄 (누구 · 성적표), 일이 많은 순으로 MEMBERS_MAX명. scores는 AgentRepository.scores */
  static fields(
    rows: readonly TeamReviewRow[],
    scores: readonly AgentScoreRow[],
    days: number,
  ): Record<string, string | number> {
    const byAgent = new Map(scores.map((s) => [s.agent_id, s]));
    const busy = (r: TeamReviewRow) => {
      const s = byAgent.get(r.id);
      return [s?.done ?? 0, s?.judged ?? 0, r.open];
    };
    const ranked = [...rows].sort((x, y) => {
      const [a, b] = [busy(x), busy(y)];
      return (b[0] ?? 0) - (a[0] ?? 0) || (b[1] ?? 0) - (a[1] ?? 0) || (b[2] ?? 0) - (a[2] ?? 0);
    });
    const shown = ranked.slice(0, TeamReview.MEMBERS_MAX);
    const lines = shown.map((r) => TeamReview.line(r, byAgent.get(r.id) ?? null));
    const rest = rows.length - shown.length;
    if (rest > 0) lines.push(`- 그 밖에 ${rest}명 (일이 적어 뺐다. 모두 보려면 get_settings team)`);
    return { days, members: lines.join('\n') || '- 없음' };
  }

  private static line(r: TeamReviewRow, s: AgentScoreRow | null): string {
    const role = (r.role.split('\n')[0] ?? '').trim().slice(0, TeamReview.ROLE_TEXT);
    const head = [
      `${r.name} (agent_id: ${r.id})`,
      role || null,
      `AI 도구 ${r.tool}${r.model ? ` · 모델 ${r.model}` : ''}`,
      `보고: ${r.boss ?? '관리자'}`,
      r.status === 'paused' ? '멈춤' : null,
    ].filter(Boolean);
    const score = [
      `끝낸 일 ${s?.done ?? 0}`,
      `쥔 일 ${r.open}`,
      s && s.judged > 0 ? `첫 판정 통과 ${s.first_pass}/${s.judged}` : '판정 없음',
      s?.avg_fixes != null ? `평균 고친 횟수 ${s.avg_fixes}` : null,
      s && s.decided > 0 ? `관리자 반려 · 고쳐 달라 ${s.sent_back}/${s.decided}` : null,
      s?.tokens_per_done != null ? `일 하나에 토큰 ${s.tokens_per_done}` : null,
    ].filter(Boolean);
    return `- ${head.join(' · ')}\n  ${score.join(' · ')}`;
  }
}
