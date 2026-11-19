'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useApps } from '../../../_blog/live';
import type { AdminApp } from '../../../_blog/types';
import { api } from '../../../_lib/client-api';
import { SCOPE_LABELS } from '../../../_lib/types';
import { useAction } from '../../../_lib/use-action';
import { useAgents } from '../../../_task/live';
import type { AgentTeamSaved, Chat } from '../../../_task/types';
import { InstructionForm } from '../../../_ui/InstructionForm';
import { CHATS_HREF, TEAM_HREF } from '../../menu';
import { APP_TEAM_TEMPLATE, teamLeaders, teamUnder } from '../app-team';
import { type AppTeamBody, AppTeamForm } from './AppTeamForm';

const CONFLICT = '이미 바뀐 앱이에요. 최신 내용을 다시 읽었어요';

// 앱 관리 › 운영 팀 (스토어 2단계, docs/스토어.md 10장): 운영 팀장 · 편집 방침, 팀장 아래 팀, 운영 팀이 없으면 템플릿으로 만들기,
// 이 앱에 맡기기(앱을 가진 대화를 연다: 대표가 이 앱의 운영 팀장에게 맡긴다). 앱 version이 오르면 폼을 새로 만든다 (key)
export function AppTeamTab({
  app,
  onChanged,
}: {
  app: AdminApp;
  onChanged: () => Promise<unknown>;
}) {
  const router = useRouter();
  const agents = useAgents();
  const apps = useApps();
  const save = useAction();
  const make = useAction();
  const ask = useAction();
  /** 템플릿으로 만든 팀: 응답을 못 받아 다시 눌러도 팀은 하나 */
  const teamRequest = useRef('');
  if (!teamRequest.current) teamRequest.current = crypto.randomUUID();
  const list = agents.data?.agents ?? null;
  const leader = list?.find((a) => a.id === app.agentId) ?? null;
  const members = list && app.agentId ? teamUnder(list, app.agentId) : [];

  function submit(body: AppTeamBody) {
    void save.run(
      'save',
      () => api('PATCH', `/api/apps/${app.id}`, { ...body, version: app.version }),
      { done: '운영 팀 저장됨', reload: onChanged, conflict: CONFLICT },
    );
  }

  /** 앱 운영 팀 템플릿으로 팀을 만들고 편집장(맨 위)을 이 앱의 운영 팀장으로 */
  async function createTeam() {
    const made = await make.run('team', () =>
      api<AgentTeamSaved>('POST', '/api/agent-teams', {
        requestId: teamRequest.current,
        team: APP_TEAM_TEMPLATE,
      }),
    );
    const editor = made?.ok ? made.data.agents[0] : undefined;
    if (!editor) return;
    await make.run(
      'leader',
      () => api('PATCH', `/api/apps/${app.id}`, { agentId: editor.id, version: app.version }),
      {
        done: `앱 운영 팀 만듦 · ${editor.name}이(가) 운영 팀장`,
        reload: onChanged,
        conflict: CONFLICT,
      },
    );
    await agents.reload();
  }

  async function send(message: string, requestId: string) {
    const reply = await ask.run('ask', () =>
      api<Chat>('POST', '/api/chats', { requestId, message, appId: app.id }),
    );
    if (!reply?.ok) return false;
    router.push(`${CHATS_HREF}/${reply.data.id}`);
    return true;
  }

  return (
    <>
      <InstructionForm
        label="이 앱에 맡기기"
        placeholder={`예: ${app.name}에 이번 주 글 하나 써 줘`}
        submit="맡기기"
        hint="대표가 이 앱의 운영 팀장에게 맡기고, 결과는 대화의 카드로"
        busy={ask.busy !== null}
        problem={ask.problem}
        onSubmit={send}
        onEdit={ask.clear}
      />
      {agents.error && <p className="error">{agents.error}</p>}
      {list === null ? (
        !agents.error && <p className="label-mono">불러오는 중…</p>
      ) : (
        <AppTeamForm
          key={app.version}
          app={app}
          leaders={teamLeaders(list)}
          apps={apps.data?.apps ?? []}
          busy={save.busy !== null}
          problem={save.problem}
          onSubmit={submit}
          onEdit={save.clear}
        />
      )}
      {list !== null && app.agentId === null && (
        <section className="panel stack" aria-label="운영 팀 만들기">
          <b>운영 팀 없음</b>
          <p>
            앱 운영 팀 템플릿(편집장 · 작가 · 자료 조사 · 앱 디자이너)으로 팀을 만들고 편집장을 운영
            팀장으로 정함
          </p>
          {make.problem && <p className="error">{make.problem}</p>}
          <div className="row">
            <button
              type="button"
              className="ghost"
              disabled={make.busy !== null}
              onClick={() => void createTeam()}
            >
              앱 운영 팀 만들기
            </button>
          </div>
        </section>
      )}
      {leader && (
        <section className="panel stack" aria-label="팀원">
          <div className="row">
            <b>{leader.name}의 팀</b>
            <Link className="ghost small" href={TEAM_HREF}>
              팀 화면
            </Link>
          </div>
          {members.length === 0 ? (
            <p className="rows-empty">팀원 없음 · 팀장이 직접 씀</p>
          ) : (
            <ul className="list">
              {members.map(({ agent, depth }) => (
                <li key={agent.id} className="list-cell">
                  <div
                    className="item-main"
                    style={{ paddingInlineStart: `${(depth - 1) * 16}px` }}
                  >
                    <b>{agent.name}</b>
                    <small>{agent.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(' · ')}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
