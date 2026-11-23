'use client';

import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { share, tokens } from '../../_task/labels';
import { useAgents, useLead } from '../../_task/live';
import { type LeadBody, LeadForm } from './LeadForm';

// 대표 (O-2): 모든 대화를 받아 일꾼에게 나눠 맡기는 에이전트. 첫 대화에서 생긴다 (2026-11-21 팀 없는 에이전트).
// 에이전트 화면에는 맨 앞에 보이기만 하고 여기서 바꾼다 (AI 도구 · 모델 · 생각 강도 · 한도 · 검토자)
export function LeadPanel() {
  const lead = useLead();
  const agents = useAgents();
  const save = useAction();
  const boss = lead.data?.lead ?? null;

  function submit(body: LeadBody) {
    if (!boss) return;
    void save.run(
      'save',
      () => api('PATCH', `/api/agents/${boss.id}`, { ...body, version: boss.version }),
      {
        done: '대표 설정을 저장했어요',
        reload: lead.reload,
        conflict: '그사이 바뀐 대표 설정이에요. 다시 읽었어요',
      },
    );
  }

  return (
    <>
      <header className="page-head">
        <h2>대표</h2>
        {boss && boss.usedThisMonth > 0 && (
          <small className="label-mono">
            {boss.monthlyLimit === null
              ? `이번 달 ${tokens(boss.usedThisMonth)} 토큰 · 한도 없음`
              : `이번 달 ${tokens(boss.usedThisMonth)} / ${tokens(boss.monthlyLimit)} 토큰 · ${share(boss.usedThisMonth, boss.monthlyLimit)}`}
          </small>
        )}
      </header>
      <p className="note">모든 대화를 받아 일꾼에게 나눠 맡기고 결과를 모아 답해요</p>
      {lead.error && <p className="error">{lead.error}</p>}
      {boss ? (
        <LeadForm
          key={boss.version}
          lead={boss}
          agents={agents.data?.agents ?? []}
          busy={save.busy !== null}
          problem={save.problem}
          onSubmit={submit}
        />
      ) : (
        lead.data && <p className="rows-empty">첫 대화를 열면 대표가 생겨요</p>
      )}
    </>
  );
}
