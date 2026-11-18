'use client';

import { type FormEvent, useId, useRef, useState } from 'react';

/** 칸의 길이 (서버 Issue의 값과 같다) */
const TITLE_MAX = 120;
const INTRO_MAX = 2000;

// 새 호 하나: 제목과 소개. 번호는 서버가 다음 수로 정한다. 저장은 패널이 한다.
export function IssueForm({
  busy,
  problem,
  onSubmit,
  onEdit,
}: {
  busy: boolean;
  problem: string | null;
  /** 만들었으면 true: 칸을 비운다 */
  onSubmit: (body: { title: string; intro: string | null }, requestId: string) => Promise<boolean>;
  onEdit: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [intro, setIntro] = useState('');
  const requestId = useRef<string | null>(null);

  function edit(apply: () => void) {
    requestId.current = null;
    onEdit();
    apply();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    requestId.current ??= crypto.randomUUID();
    const body = { title: title.trim(), intro: intro.trim() || null };
    if (!(await onSubmit(body, requestId.current))) return;
    requestId.current = null;
    setTitle('');
    setIntro('');
  }

  return (
    <form className="panel stack" onSubmit={submit} aria-label="새 호">
      <div className="field">
        <label htmlFor={`${id}-title`}>호 제목</label>
        <input
          id={`${id}-title`}
          className="input"
          value={title}
          required
          maxLength={TITLE_MAX}
          placeholder="예: 가을호"
          onChange={(e) => edit(() => setTitle(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-intro`}>소개</label>
        <textarea
          id={`${id}-intro`}
          className="input"
          rows={2}
          value={intro}
          maxLength={INTRO_MAX}
          onChange={(e) => edit(() => setIntro(e.target.value))}
        />
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy || !title.trim()}>
          호 추가
        </button>
      </div>
    </form>
  );
}
