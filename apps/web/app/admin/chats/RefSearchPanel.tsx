'use client';

import { type FormEvent, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';
import type { LibraryPage } from '../../_platform/types';
import { REF_KINDS } from '../../_task/labels';
import type { ChatRef } from '../../_task/types';

/** 비공개로 보는 값 밖 (서버 TaskRefs.PUBLIC과 같다) */
const PUBLIC = ['public', 'published'];

// 참조 고르기의 보관함 찾기 (2026-11-15 B): 제목으로 찾아 위키 · 세션 · 글 · 페이지 · 결과물 · 스크랩을 고른다.
// 찾기는 Enter · 찾기 단추로 (글자마다 묻지 않게). 빈 글이면 최근 것부터
export function RefSearchPanel({ onPick }: { onPick: (ref: Omit<ChatRef, 'private'>) => void }) {
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const path = q ? `/api/library?q=${encodeURIComponent(q)}` : '/api/library';
  const list = useLiveValue(`ref-search:${q}`, () => api<LibraryPage>('GET', path), []);
  const items = list.data?.items ?? [];

  function search(e: FormEvent) {
    e.preventDefault();
    setQ(typed.trim());
  }

  return (
    <div className="ref-search">
      <form className="row" onSubmit={search}>
        <input
          className="input small grow"
          aria-label="보관함에서 찾기"
          placeholder="제목으로 찾기"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" className="ghost small">
          찾기
        </button>
      </form>
      {list.error && <p className="error">{list.error}</p>}
      {list.data && items.length === 0 && <p className="note">찾은 것 없음</p>}
      <ul className="ref-results">
        {items.map((i) => (
          <li key={`${i.kind}:${i.id}`}>
            <button
              type="button"
              className="ref-result"
              onClick={() =>
                onPick({
                  kind: i.kind,
                  id: i.id,
                  title: i.title,
                  url: null,
                  browser: false,
                  image: false,
                })
              }
            >
              <span className="pill">{REF_KINDS[i.kind] ?? i.kind}</span>
              <span className="clamp-1">{i.title}</span>
              {!PUBLIC.includes(i.visibility) && <span className="note">비공개</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
