'use client';

import { type FormEvent, useState } from 'react';
import type { AdminPostSummary } from '../../../../../_blog/types';

// 호에 든 글 고르기: 고른 순서가 호의 순서다. 임시 글과 이 호에 든 글만 보인다 (다른 호에 든 글은 빼고).
export function IssuePostsForm({
  issueId,
  posts,
  chosen,
  busy,
  problem,
  onSubmit,
  onClose,
}: {
  issueId: string;
  posts: readonly AdminPostSummary[];
  /** 지금 든 글 (순서대로) */
  chosen: readonly string[];
  busy: boolean;
  problem: string | null;
  onSubmit: (postIds: readonly string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<readonly string[]>(chosen);
  const candidates = posts.filter(
    (p) => p.deletedAt === null && (p.issueId === null || p.issueId === issueId),
  );

  function toggle(id: string) {
    setPicked(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(picked);
  }

  return (
    <form className="panel stack" onSubmit={submit} aria-label="호의 글">
      {candidates.length === 0 ? (
        <p className="note">넣을 임시 글 없음</p>
      ) : (
        <fieldset className="checks" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <legend>글 (고른 순서가 호의 순서)</legend>
          {candidates.map((p) => (
            <label key={p.id} className="check">
              <input
                type="checkbox"
                checked={picked.includes(p.id)}
                onChange={() => toggle(p.id)}
              />
              {picked.includes(p.id) ? `${picked.indexOf(p.id) + 1}. ` : ''}
              {p.title || '제목 없음'}
            </label>
          ))}
        </fieldset>
      )}
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy}>
          저장
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
