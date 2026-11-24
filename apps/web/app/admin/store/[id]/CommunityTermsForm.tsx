'use client';

import { useState } from 'react';

/** 약관 한 장의 본문(마크다운). 처음이면 초안이 채워져 있다. 저장(공개)은 패널이 한다 */
export function CommunityTermsForm({
  initial,
  first,
  busy,
  problem,
  onSubmit,
}: {
  initial: string;
  first: boolean;
  busy: boolean;
  problem: string | null;
  onSubmit: (body: string) => void;
}) {
  const [body, setBody] = useState(initial);
  const changed = body.trim() !== initial.trim();

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(body);
      }}
    >
      <textarea
        className="input"
        rows={14}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={50_000}
        aria-label="본문 (마크다운)"
      />
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button
          className="cta"
          type="submit"
          disabled={busy || body.trim().length === 0 || (!first && !changed)}
        >
          {first ? '공개' : '새 버전으로 공개'}
        </button>
        <span className="label-mono">{body.trim().length.toLocaleString('ko-KR')} / 50,000자</span>
      </div>
    </form>
  );
}
