'use client';

import { useState } from 'react';
import { CLAUDE_MODELS, EFFORT_LABELS, TOOL_EFFORTS } from '../../_task/labels';

// 대화의 모델 · 생각 강도 (2026-11-15 B): 맡은 에이전트의 도구가 받는 것만. 비우면 에이전트의 설정.
// 도구(Claude · Codex)는 대화에서 바꾸지 않는다. Claude는 별칭(opus · sonnet · haiku), Codex는 모델 이름을 적는다
export function ChatRuntimeForm({
  tool,
  model,
  effort,
  busy,
  onSubmit,
}: {
  tool: string;
  model: string | null;
  effort: string | null;
  busy: boolean;
  onSubmit: (body: { model: string | null; effort: string | null }) => void;
}) {
  const [typed, setTyped] = useState(model ?? '');
  const efforts = TOOL_EFFORTS[tool] ?? [];
  const send = (next: { model?: string | null; effort?: string | null }) =>
    onSubmit({
      model: next.model !== undefined ? next.model || null : model,
      effort: next.effort !== undefined ? next.effort || null : effort,
    });

  return (
    <fieldset className="chat-runtime" aria-label="이 대화의 모델">
      {tool === 'claude' ? (
        <select
          className="input small"
          aria-label="모델"
          value={model ?? ''}
          disabled={busy}
          onChange={(e) => send({ model: e.target.value })}
        >
          {CLAUDE_MODELS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input small"
          aria-label="모델"
          placeholder="에이전트 설정"
          value={typed}
          disabled={busy}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={() => typed.trim() !== (model ?? '') && send({ model: typed.trim() })}
        />
      )}
      <select
        className="input small"
        aria-label="생각 강도"
        value={effort ?? ''}
        disabled={busy}
        onChange={(e) => send({ effort: e.target.value })}
      >
        <option value="">생각 · 에이전트 설정</option>
        {efforts.map((e) => (
          <option key={e} value={e}>
            생각 {EFFORT_LABELS[e] ?? e}
          </option>
        ))}
      </select>
    </fieldset>
  );
}
