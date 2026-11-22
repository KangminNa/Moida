'use client';

import { type FormEvent, useState } from 'react';

const SAMPLE = '[\n  {  }\n]';

// 표에 줄 넣기 (앱 데이터, 스토어 12.4): 줄의 목록을 JSON으로 받는다 (칸은 앱이 선언한 것이라 칸마다 입력을 그리지 않는다).
// JSON이 맞는지만 여기서 보고, 칸 · 타입은 서버가 본다
export function AppDataForm({
  columns,
  busy,
  onSubmit,
}: {
  columns: Readonly<Record<string, string>>;
  busy: boolean;
  onSubmit: (rows: unknown[]) => void;
}) {
  const [text, setText] = useState(SAMPLE);
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    let rows: unknown;
    try {
      rows = JSON.parse(text);
    } catch {
      setProblem('JSON으로 읽을 수 없어요');
      return;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      setProblem('줄의 목록([ { … } ])으로 적어요');
      return;
    }
    setProblem(null);
    onSubmit(rows);
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        <span>
          넣을 줄 (JSON) ·{' '}
          {Object.entries(columns)
            .map(([name, type]) => `${name}: ${type}`)
            .join(' · ')}
        </span>
        <textarea
          className="input"
          rows={8}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy}>
          넣기
        </button>
      </div>
    </form>
  );
}
