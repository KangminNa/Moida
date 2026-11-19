'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import { APP_KIND_LABELS } from '../../../_blog/labels';
import type { AdminApp, PageList } from '../../../_blog/types';
import type { Agent } from '../../../_task/types';
import { leaderLabel } from '../app-team';

/** 칸의 길이 (서버 App의 값과 같다) */
const NAME_MAX = 40;
const SLUG_MAX = 30;
const DESCRIPTION_MAX = 200;
/** 서버가 받는 아이콘 형식 (UploadIconInput). SVG는 받지 않는다 */
const ICON_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

/** 만들 때 보내는 본문 (POST /api/apps). requestId는 패널이 붙인다 */
export type CreateAppBody = {
  kind: AdminApp['kind'];
  name: string;
  slug: string;
  description: string;
  menus?: string[];
  pageId?: string;
  /** 운영 팀장 (스토어 2단계) */
  agentId?: string;
};

/** 운영 팀 칸에서 "앱 운영 팀 새로 만들기"의 값 */
const NEW_TEAM = 'new';

// 앱 만들기 시트 (스토어 1-5, 시안 3번): 아이콘 · 이름 · 주소 · 설명, 블로그는 시작 메뉴, 페이지 앱은 앱이 될 페이지.
// 비공개로 만들어진다. 운영 팀(스토어 2단계): 나중에 · 있는 팀장 · 앱 운영 팀 새로 만들기.
// 저장(새 팀 → 만들기 → 아이콘 올리기)은 패널이 한다.
export function CreateAppForm({
  kind,
  origin,
  pages,
  leaders,
  apps,
  busy,
  problem,
  onSubmit,
  onEdit,
  onClose,
}: {
  kind: AdminApp['kind'];
  /** 공개 주소 앞부분 (사이트 주소) */
  origin: string;
  /** 앱 밖의 페이지 (페이지 앱이 될 수 있는 것) */
  pages: PageList['pages'];
  /** 운영 팀장이 될 수 있는 에이전트 (app-team.ts teamLeaders) */
  leaders: readonly Agent[];
  /** 모든 앱 (팀장마다 이미 운영하는 앱을 이름 옆에) */
  apps: readonly AdminApp[];
  busy: boolean;
  problem: string | null;
  /** 만들기. newTeam이면 앱 운영 팀을 먼저 만들어 그 편집장을 팀장으로. 됐으면 true */
  onSubmit: (
    body: CreateAppBody,
    icon: File | null,
    requestId: string,
    newTeam: boolean,
  ) => Promise<boolean>;
  onEdit: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [menus, setMenus] = useState('');
  const [pageId, setPageId] = useState('');
  const [icon, setIcon] = useState<File | null>(null);
  const [team, setTeam] = useState('');
  const requestId = useRef<string | null>(null);

  function edit(apply: () => void) {
    requestId.current = null;
    onEdit();
    apply();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const names = menus
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    const body: CreateAppBody = {
      kind,
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
      ...(kind === 'blog' && names.length > 0 ? { menus: names } : {}),
      ...(kind === 'page' ? { pageId } : {}),
      ...(team && team !== NEW_TEAM ? { agentId: team } : {}),
    };
    requestId.current ??= crypto.randomUUID();
    if (await onSubmit(body, icon, requestId.current, team === NEW_TEAM)) requestId.current = null;
  }

  return (
    <form className="panel stack" onSubmit={submit} aria-label={`${APP_KIND_LABELS[kind]} 만들기`}>
      <b>{APP_KIND_LABELS[kind]} 만들기</b>
      <div className="field">
        <label htmlFor={`${id}-name`}>이름</label>
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          required
          maxLength={NAME_MAX}
          placeholder="예: 요리 블로그"
          onChange={(e) => edit(() => setName(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-slug`}>주소</label>
        <div className="row slug-row">
          <span className="label-mono">{origin}/</span>
          <input
            id={`${id}-slug`}
            className="input"
            value={slug}
            required
            minLength={2}
            maxLength={SLUG_MAX}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            placeholder="cooking"
            onChange={(e) => edit(() => setSlug(e.target.value.toLowerCase()))}
          />
        </div>
        <small>영어 소문자 · 숫자 · 하이픈. admin · api · login 같은 이름은 못 씀</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-description`}>설명 (공개 첫 화면에 보임)</label>
        <input
          id={`${id}-description`}
          className="input"
          value={description}
          maxLength={DESCRIPTION_MAX}
          placeholder="예: 집에서 만든 레시피와 다녀온 맛집 기록"
          onChange={(e) => edit(() => setDescription(e.target.value))}
        />
      </div>
      {kind === 'blog' && (
        <div className="field">
          <label htmlFor={`${id}-menus`}>시작 메뉴 (쉼표로 나눔, 5개까지)</label>
          <input
            id={`${id}-menus`}
            className="input"
            value={menus}
            placeholder="비우면 '글' 하나 · 예: 레시피, 맛집"
            onChange={(e) => edit(() => setMenus(e.target.value))}
          />
        </div>
      )}
      {kind === 'page' && (
        <div className="field">
          <label htmlFor={`${id}-page`}>앱이 될 페이지</label>
          <select
            id={`${id}-page`}
            className="input"
            value={pageId}
            required
            onChange={(e) => edit(() => setPageId(e.target.value))}
          >
            <option value="">고르기</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.name})
              </option>
            ))}
          </select>
          {pages.length === 0 && <small>앱 밖의 페이지 없음 · 대화에서 페이지부터 만들기</small>}
        </div>
      )}
      <div className="field">
        <span>아이콘 (공개 첫 화면의 앱 목록에 보임, 없으면 종류 아이콘)</span>
        <label className="ghost file-pick">
          {icon ? icon.name : '그림 올리기'}
          <input
            type="file"
            accept={ICON_TYPES}
            hidden
            onChange={(e) => edit(() => setIcon(e.target.files?.[0] ?? null))}
          />
        </label>
      </div>
      <div className="field">
        <label htmlFor={`${id}-team`}>운영 팀</label>
        <select
          id={`${id}-team`}
          className="input"
          value={team}
          onChange={(e) => edit(() => setTeam(e.target.value))}
        >
          <option value="">나중에 (앱 관리 › 운영 팀에서)</option>
          <option value={NEW_TEAM}>
            앱 운영 팀 새로 만들기 (편집장 · 작가 · 자료 조사 · 앱 디자이너)
          </option>
          {leaders.map((a) => (
            <option key={a.id} value={a.id}>
              {leaderLabel(a, apps)}
            </option>
          ))}
        </select>
        <small>대표가 이 앱의 일을 운영 팀장에게 맡김</small>
      </div>
      <p className="note">비공개로 만들어짐 · 앱 관리에서 공개로 바꿈</p>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="button" className="ghost" onClick={onClose}>
          취소
        </button>
        <button type="submit" className="cta" disabled={busy}>
          {busy ? '만드는 중' : '만들기'}
        </button>
      </div>
    </form>
  );
}
