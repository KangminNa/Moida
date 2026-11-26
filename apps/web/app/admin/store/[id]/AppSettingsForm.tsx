'use client';

import { type FormEvent, useId, useState } from 'react';
import type { AdminApp } from '../../../_blog/types';
import { SaveButton } from '../../../_ui/SaveButton';

/** 칸의 길이 (서버 App의 값과 같다) */
const NAME_MAX = 40;
const SLUG_MAX = 30;
const DESCRIPTION_MAX = 200;
const SORT_MAX = 1000;
/** 편집 방침의 길이 (서버 App.POLICY_MAX와 같다) */
const POLICY_MAX = 4000;

/** 고칠 때 보내는 본문 (PATCH /api/apps/:id). version은 패널이 붙인다 */
export type AppSettingsBody = {
  name: string;
  slug: string;
  description: string;
  sort: number;
  policy: string;
};

// 앱 관리 › 설정의 칸 (스토어 1-5): 이름 · 주소 · 설명 · 순서 · 편집 방침(스토어 2단계, 2026-11-21 앱 설정으로 옮김).
// 종류는 바꾸지 않는다. 저장은 패널이 한다.
export function AppSettingsForm({
  app,
  busy,
  saved,
  problem,
  onSubmit,
  onEdit,
}: {
  app: AdminApp;
  busy: boolean;
  /** 방금 저장이 끝났는지 (버튼이 잠깐 체크) */
  saved: boolean;
  problem: string | null;
  onSubmit: (body: AppSettingsBody) => void;
  onEdit: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(app.name);
  const [slug, setSlug] = useState(app.slug);
  const [description, setDescription] = useState(app.description);
  const [sort, setSort] = useState(app.sort);
  const [policy, setPolicy] = useState(app.policy);

  function edit(apply: () => void) {
    onEdit();
    apply();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
      sort,
      policy: policy.trim(),
    });
  }

  return (
    <form className="panel stack" onSubmit={submit} aria-label="앱 설정">
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
          required
          minLength={2}
          maxLength={SLUG_MAX}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          onChange={(e) => edit(() => setSlug(e.target.value.toLowerCase()))}
        />
        {slug.trim() !== app.slug && (
          <small>주소를 바꾸면 예전 주소(/{app.slug}/…)로는 못 찾음</small>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${id}-description`}>설명</label>
        <input
          id={`${id}-description`}
          className="input"
          value={description}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => edit(() => setDescription(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-sort`}>순서 (작을수록 앞, 공개 첫 화면의 앱 목록)</label>
        <input
          id={`${id}-sort`}
          className="input"
          type="number"
          min={0}
          max={SORT_MAX}
          value={sort}
          onChange={(e) => edit(() => setSort(Number(e.target.value)))}
        />
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
        <SaveButton busy={busy} saved={saved} />
      </div>
    </form>
  );
}
