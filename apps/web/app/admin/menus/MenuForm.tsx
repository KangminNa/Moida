'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import { MENU_KIND_LABELS } from '../../_blog/labels';
import type { Menu } from '../../_blog/types';
import type { Agent } from '../../_task/types';

/** 칸의 길이 (서버 Menu의 값과 같다) */
const NAME_MAX = 40;
const SLUG_MAX = 60;
const POLICY_MAX = 4000;

/** 저장할 때 보내는 본문 (POST · PATCH /api/menus). 만들기의 requestId와 고치기의 version은 패널이 붙인다 */
export type MenuBody = {
  kind?: string;
  name: string;
  slug?: string;
  sort: number;
  policy: string;
  agentId: string | null;
  rss: boolean;
};

// 메뉴 하나를 만들거나 고치는 폼: 칸의 상태와 보낼 본문만 가진다. 저장은 패널이 돌린다.
// 종류는 만들 때만 고른다. 운영 팀은 비공개를 읽지 않는 에이전트만 보인다 (서버도 422로 막는다).
export function MenuForm({
  menu,
  agents,
  busy,
  problem,
  onSubmit,
  onEdit,
  onClose,
}: {
  /** 고칠 메뉴. 없으면 새로 만든다 */
  menu: Menu | null;
  agents: readonly Agent[];
  busy: boolean;
  problem: string | null;
  /** 저장. 됐으면 true */
  onSubmit: (body: MenuBody, requestId: string) => Promise<boolean>;
  onEdit: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [kind, setKind] = useState(menu?.kind ?? 'posts');
  const [name, setName] = useState(menu?.name ?? '');
  const [slug, setSlug] = useState(menu?.slug ?? '');
  const [sort, setSort] = useState(menu?.sort ?? 0);
  const [policy, setPolicy] = useState(menu?.policy ?? '');
  const [agentId, setAgentId] = useState(menu?.agentId ?? '');
  const [rss, setRss] = useState(menu?.rss ?? true);
  const requestId = useRef<string | null>(null);
  const team = agents.filter((a) => !a.scopes.includes('read_all') || a.id === agentId);

  function edit(apply: () => void) {
    requestId.current = null;
    onEdit();
    apply();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body: MenuBody = {
      ...(menu ? {} : { kind }),
      name: name.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      sort,
      policy: policy.trim(),
      agentId: agentId || null,
      rss,
    };
    requestId.current ??= crypto.randomUUID();
    if (await onSubmit(body, requestId.current)) requestId.current = null;
  }

  return (
    <form
      className="panel stack"
      onSubmit={submit}
      aria-label={menu ? `${menu.name} 편집` : '새 메뉴'}
    >
      <b>{menu ? `${menu.name} 편집` : '새 메뉴'}</b>
      {!menu && (
        <div className="field">
          <label htmlFor={`${id}-kind`}>종류</label>
          <select
            id={`${id}-kind`}
            className="input"
            value={kind}
            onChange={(e) => edit(() => setKind(e.target.value))}
          >
            {Object.entries(MENU_KIND_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <small>만든 뒤에는 바꾸지 않음</small>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-name`}>이름</label>
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          required
          maxLength={NAME_MAX}
          onChange={(e) => edit(() => setName(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-slug`}>주소</label>
        <input
          id={`${id}-slug`}
          className="input"
          value={slug}
          maxLength={SLUG_MAX}
          placeholder="비우면 이름에서 만듦"
          onChange={(e) => edit(() => setSlug(e.target.value))}
        />
        <small>/m/{slug.trim() || '…'}</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-sort`}>순서</label>
        <input
          id={`${id}-sort`}
          className="input"
          type="number"
          min={0}
          max={1000}
          value={sort}
          onChange={(e) => edit(() => setSort(Number(e.target.value)))}
        />
        <small>작은 수가 메뉴 줄의 앞</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-policy`}>편집 방침</label>
        <textarea
          id={`${id}-policy`}
          className="input"
          rows={4}
          value={policy}
          maxLength={POLICY_MAX}
          placeholder="예: 일기 말투로, 사진 한 장 이상, 출처를 끝에"
          onChange={(e) => edit(() => setPolicy(e.target.value))}
        />
        <small>이 메뉴에 쓰는 AI가 읽음</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-agent`}>운영 팀</label>
        <select
          id={`${id}-agent`}
          className="input"
          value={agentId}
          onChange={(e) => edit(() => setAgentId(e.target.value))}
        >
          <option value="">없음</option>
          {team.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <small>비공개를 읽지 않는 에이전트만</small>
      </div>
      <label className="check">
        <input type="checkbox" checked={rss} onChange={() => edit(() => setRss(!rss))} />
        RSS (글 목록 메뉴)
      </label>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy || !name.trim()}>
          저장
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
