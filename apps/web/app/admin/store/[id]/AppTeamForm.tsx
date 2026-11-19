'use client';

import { type FormEvent, useId, useState } from 'react';
import type { AdminApp } from '../../../_blog/types';
import type { Agent } from '../../../_task/types';
import { leaderLabel } from '../app-team';

/** 편집 방침의 길이 (서버 App.POLICY_MAX와 같다) */
const POLICY_MAX = 4000;

/** 고칠 때 보내는 본문 (PATCH /api/apps/:id). version은 패널이 붙인다 */
export type AppTeamBody = { agentId: string | null; policy: string };

// 앱 관리 › 운영 팀의 칸 (스토어 2단계): 운영 팀장(맨 위의, 비공개를 읽지 않는 에이전트) · 편집 방침. 저장은 패널이 한다.
export function AppTeamForm({
  app,
  leaders,
  apps,
  busy,
  problem,
  onSubmit,
  onEdit,
}: {
  app: AdminApp;
  /** 고를 수 있는 팀장 (app-team.ts teamLeaders) */
  leaders: readonly Agent[];
  /** 모든 앱 (팀장마다 이미 운영하는 앱을 이름 옆에) */
  apps: readonly AdminApp[];
  busy: boolean;
  problem: string | null;
  onSubmit: (body: AppTeamBody) => void;
  onEdit: () => void;
}) {
  const id = useId();
  const [agentId, setAgentId] = useState(app.agentId ?? '');
  const [policy, setPolicy] = useState(app.policy);
  // 지금 팀장이 목록에 없으면(지운 에이전트 · 권한이 바뀜) 그대로 보이게 둔다
  const missing = app.agentId !== null && !leaders.some((a) => a.id === app.agentId);

  function edit(apply: () => void) {
    onEdit();
    apply();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ agentId: agentId || null, policy: policy.trim() });
  }

  return (
    <form className="panel stack" onSubmit={submit} aria-label="운영 팀">
      <div className="field">
        <label htmlFor={`${id}-leader`}>운영 팀장</label>
        <select
          id={`${id}-leader`}
          className="input"
          value={agentId}
          onChange={(e) => edit(() => setAgentId(e.target.value))}
        >
          <option value="">없음 (비공개를 읽지 않는 에이전트 누구나)</option>
          {missing && <option value={app.agentId ?? ''}>없는 에이전트 (다시 고르기)</option>}
          {leaders.map((a) => (
            <option key={a.id} value={a.id}>
              {leaderLabel(a, apps, app.id)}
            </option>
          ))}
        </select>
        <small>팀장과 그 아래 팀만 이 앱에 글을 놓음. 대표가 이 앱의 일을 팀장에게 맡김</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-policy`}>편집 방침</label>
        <textarea
          id={`${id}-policy`}
          className="input"
          rows={5}
          value={policy}
          maxLength={POLICY_MAX}
          placeholder="예: 한 글에 사진 한 장 이상. 반말 금지. 제목은 30자 안"
          onChange={(e) => edit(() => setPolicy(e.target.value))}
        />
        <small>이 앱에 쓰는 AI가 메뉴의 방침과 함께 지킴</small>
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta" disabled={busy}>
          저장
        </button>
      </div>
    </form>
  );
}
