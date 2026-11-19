'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useSpace } from '../../../_account/live';
import { APP_KIND_LABELS } from '../../../_blog/labels';
import { useApps, usePages } from '../../../_blog/live';
import type { AdminApp } from '../../../_blog/types';
import { api, uploadFile } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { useAgents } from '../../../_task/live';
import type { AgentTeamSaved } from '../../../_task/types';
import { Icon } from '../../../_ui/Icon';
import { CHAT_HREF, STORE_HREF } from '../../menu';
import { APP_TEAM_TEMPLATE, teamLeaders } from '../app-team';
import { type CreateAppBody, CreateAppForm } from './CreateAppForm';

/** 스토어(앱 종류) 화면의 주소 */
const STORE_NEW_HREF = `${STORE_HREF}/new`;

/** 앱 종류 카드: 종류 · 아이콘 · 설명 (서버 blog.tables의 APP_KIND) */
const KINDS: readonly [AdminApp['kind'], string, string][] = [
  ['blog', 'post', '글 · 메뉴 · RSS. 글은 버전으로 남고, 공개는 승인 뒤에'],
  ['magazine', 'book', '호 단위로 글을 묶어 한 번에 발행. 호 목록 · 이번 호'],
  ['page', 'site', 'AI가 HTML · JS로 만든 화면 하나. 데이터 파일만 바꿔 갱신. 서버 기능 없음'],
];

// 스토어 (스토어 1-5, 시안 2 · 3번): 앱 종류를 골라 만들기 시트를 연다. 만들면 앱 관리로 간다.
// 커뮤니티는 3단계라 준비 중으로만 보인다. 원하는 종류가 없으면 대화에서 맡긴다 (코드 작업 → 기능 패키지).
// 시트는 주소(?make=종류, page.tsx가 넘김)에 둔다 (웹 UX U1): 열기는 기록을 하나 쌓고, 닫기는 여기서 연 것이면 뒤로 ·
// 주소로 바로 들어왔으면 바꿔치기, 만든 뒤에는 앱 관리로 바꿔치기한다 (뒤로 가기가 다시 시트를 열지 않게)
export function StorePanel({ make }: { make: string | null }) {
  const router = useRouter();
  const apps = useApps();
  const pages = usePages();
  const agents = useAgents();
  const save = useAction();
  const kind = KINDS.find(([value]) => value === make)?.[0] ?? null;
  /** 이 화면에서 시트를 열었는가 (닫을 때 뒤로 갈 수 있는지) */
  const opened = useRef(false);
  const space = useSpace();
  const list = apps.data?.apps ?? [];
  /** 공개 주소 앞부분: 사이트 주소에서 https:// 와 끝 / 를 뺀 것 */
  const origin = (space.data?.siteUrl ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');

  /** 새 팀이면 앱 운영 팀을 먼저 만들고(같은 requestId: 다시 눌러도 팀은 하나) 편집장을 운영 팀장으로 */
  async function create(
    body: CreateAppBody,
    icon: File | null,
    requestId: string,
    newTeam: boolean,
  ) {
    let agentId = body.agentId;
    if (newTeam) {
      const team = await save.run('team', () =>
        api<AgentTeamSaved>('POST', '/api/agent-teams', { requestId, team: APP_TEAM_TEMPLATE }),
      );
      agentId = team?.ok ? team.data.agents[0]?.id : undefined;
      if (!agentId) return false;
    }
    const made = await save.run('create', () =>
      api<AdminApp>('POST', '/api/apps', { ...body, ...(agentId ? { agentId } : {}), requestId }),
    );
    if (!made?.ok) return false;
    const app = made.data;
    if (icon)
      await save.run('icon', () =>
        uploadFile<AdminApp>(
          `/api/apps/${app.id}/icon?version=${app.version}`,
          icon,
          icon.type,
          'PUT',
        ),
      );
    router.replace(`${STORE_HREF}/${app.id}`);
    return true;
  }

  function open(value: AdminApp['kind']) {
    save.clear();
    opened.current = true;
    router.push(`${STORE_NEW_HREF}?make=${value}`, { scroll: false });
  }

  function close() {
    save.clear();
    if (opened.current) router.back();
    else router.replace(STORE_NEW_HREF, { scroll: false });
    opened.current = false;
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>스토어</h1>
          <p>앱 종류를 골라 새 앱 만들기. 만든 앱은 비공개로 시작</p>
        </div>
      </header>
      {kind && (
        <CreateAppForm
          key={kind}
          kind={kind}
          origin={origin}
          pages={(pages.data?.pages ?? []).filter((p) => p.appId === null)}
          leaders={teamLeaders(agents.data?.agents ?? [])}
          apps={list}
          busy={save.busy !== null}
          problem={save.problem}
          onSubmit={create}
          onEdit={save.clear}
          onClose={close}
        />
      )}
      <ul className="store-kinds" aria-label="앱 종류">
        {KINDS.map(([value, icon, help]) => {
          const made = list.filter((a) => a.kind === value).map((a) => a.name);
          return (
            <li key={value} className="panel store-kind">
              <span className="store-kind-icon" aria-hidden="true">
                <Icon name={icon} />
              </span>
              <b>{APP_KIND_LABELS[value]}</b>
              <p>{help}</p>
              {made.length > 0 && <small>만든 앱: {made.join(' · ')}</small>}
              <button
                type="button"
                className="cta small"
                aria-pressed={kind === value}
                onClick={() => open(value)}
              >
                만들기
              </button>
            </li>
          );
        })}
        <li className="panel store-kind" aria-disabled="true">
          <span className="store-kind-icon" aria-hidden="true">
            <Icon name="team" />
          </span>
          <b>
            커뮤니티 <span className="pill">준비 중</span>
          </b>
          <p>회원 가입 · 글 · 댓글 · 신고. 따로 설계 · 보안 검토 뒤에 열림</p>
        </li>
      </ul>
      <section className="panel stack" aria-label="원하는 종류가 없을 때">
        <b>원하는 종류가 없을 때</b>
        <p>
          "예약 받는 앱 만들어 줘"처럼 대화에서 맡기면 코드 작업으로 기능 패키지를 만들어 PR을 올림.
          머지 · 배포 뒤 여기에 새 종류로 보임
        </p>
        <Link className="ghost" href={CHAT_HREF}>
          대화에서 맡기기
        </Link>
      </section>
    </>
  );
}
