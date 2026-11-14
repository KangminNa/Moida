'use client';

import { type FormEvent, useId, useState } from 'react';

/** 방향의 길이 (서버 Page.DIRECTION_MAX와 같다) */
const DIRECTION_MAX = 4000;

// 페이지 편집: 제목과 방향. 칸만 들고, 저장은 패널이 한다. 주소(이름)는 바뀌지 않는다.
// 방향은 이 페이지의 쓰임이다: 새 버전을 만드는 AI가 지시와 함께 읽는다 (관리자만 고친다).
export function PageEditForm({
  title,
  direction,
  busy,
  problem,
  onSubmit,
  onClose,
}: {
  title: string;
  direction: string;
  busy: boolean;
  problem: string | null;
  onSubmit: (changes: { title: string; direction: string }) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(title);
  const [aim, setAim] = useState(direction);
  const changed = name.trim() !== title || aim.trim() !== direction;

  function send(event: FormEvent) {
    event.preventDefault();
    onSubmit({ title: name.trim(), direction: aim.trim() });
  }

  return (
    <form className="panel" onSubmit={send}>
      <div className="field">
        <label htmlFor={`${id}-title`}>제목</label>
        <input
          id={`${id}-title`}
          className="input"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <small>주소는 그대로</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-direction`}>방향</label>
        <textarea
          id={`${id}-direction`}
          className="input"
          rows={4}
          value={aim}
          maxLength={DIRECTION_MAX}
          placeholder="예: 매주 월요일 숫자를 새로 채우고, 지난주와 달라진 점을 맨 위에"
          onChange={(e) => setAim(e.target.value)}
        />
        <small>새 버전을 만들 때 지시와 함께 읽음</small>
      </div>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy || !name.trim() || !changed}>
          저장
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
