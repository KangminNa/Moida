'use client';

import { type ChangeEvent, useState } from 'react';
import { REF_KINDS } from '../../_task/labels';
import type { ChatRef } from '../../_task/types';
import { RefSearchPanel } from './RefSearchPanel';

/** 보낼 참조 하나 (서버가 비공개 여부를 정한다) */
export type RefChoice = Omit<ChatRef, 'private'>;

/** 고른 참조의 칩들. onRemove가 있으면 빼기 단추 (보낸 메시지 아래에서는 없음) */
export function RefChips({
  refs,
  onRemove,
}: {
  refs: readonly (RefChoice & { private?: boolean })[];
  onRemove?: (index: number) => void;
}) {
  if (refs.length === 0) return null;
  return (
    <ul className="picked" aria-label="참조">
      {refs.map((r, i) => (
        <li key={`${r.kind}:${r.id ?? r.url}`} className="pill chip">
          <span>{REF_KINDS[r.kind] ?? r.kind}</span>
          <span className="clamp-1">{r.title || r.url}</span>
          {r.private && <span>· 비공개</span>}
          {r.browser && <span>· 서버 브라우저</span>}
          {onRemove && (
            <button
              type="button"
              className="unpick"
              aria-label={`${r.title || r.url} 빼기`}
              onClick={() => onRemove(i)}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// 참조 넣기 칸 (2026-11-15 B, + · @): 보관함에서 찾기, 주소 넣기, 파일 올리기 (올린 파일은 결과물이 된다).
// 파일을 올리는 동작은 패널이 돌린다 (onUpload): 폼과 이 칸은 API를 부르지 않는다
export function RefPicker({
  onPick,
  onUpload,
  onClose,
}: {
  onPick: (ref: RefChoice) => void;
  /** 파일을 올려 결과물로 만든다. 실패하면 null (오류는 패널이 보인다) */
  onUpload: ((file: File) => Promise<RefChoice | null>) | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'library' | 'url'>('library');
  const [url, setUrl] = useState('');
  const [browser, setBrowser] = useState(false);
  const [uploading, setUploading] = useState(false);
  const goodUrl = /^https?:\/\/\S+$/i.test(url.trim());

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onUpload) return;
    setUploading(true);
    const ref = await onUpload(file);
    setUploading(false);
    if (ref) onPick(ref);
  }

  return (
    <div className="ref-picker" role="dialog" aria-label="참조 넣기">
      <div className="row">
        <button
          type="button"
          className={tab === 'library' ? 'ghost small on' : 'ghost small'}
          onClick={() => setTab('library')}
        >
          보관함
        </button>
        <button
          type="button"
          className={tab === 'url' ? 'ghost small on' : 'ghost small'}
          onClick={() => setTab('url')}
        >
          주소
        </button>
        {onUpload && (
          <label className="ghost small file-pick">
            {uploading ? '올리는 중' : '파일 올리기'}
            <input type="file" hidden disabled={uploading} onChange={upload} />
          </label>
        )}
        <span className="grow" />
        <button type="button" className="text-button" onClick={onClose}>
          닫기
        </button>
      </div>
      {tab === 'library' ? (
        <RefSearchPanel onPick={onPick} />
      ) : (
        <div className="stack">
          <input
            className="input small"
            aria-label="주소"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <label className="row">
            <input
              type="checkbox"
              checked={browser}
              onChange={(e) => setBrowser(e.target.checked)}
            />
            서버 브라우저로 열기 (로그인 · 누르기가 필요한 사이트)
          </label>
          <button
            type="button"
            className="cta small fit"
            disabled={!goodUrl}
            onClick={() => {
              onPick({
                kind: 'url',
                id: null,
                title: url.trim(),
                url: url.trim(),
                browser,
                image: false,
              });
              setUrl('');
              setBrowser(false);
            }}
          >
            넣기
          </button>
        </div>
      )}
    </div>
  );
}
