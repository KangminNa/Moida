'use client';

import { useState } from 'react';
import { EFFORT_LABELS, STOP_LABELS } from '../../_task/labels';
import { useEngines } from '../../_task/live';
import type { Chat } from '../../_task/types';

// 대화의 모델 · 생각 강도 (2026-11-15 B): 맡은 에이전트의 도구가 받는 것만. 비우면 에이전트의 설정.
// 도구는 대화에서 바꾸지 않는다. 고를 모델 목록이 있는 엔진(엔진 목록의 models)은 고르고, 없으면 모델 이름을 적는다.
// 멈춤 기준 (L3): 일꾼의 판단에서 어디까지 멈춰 고를지 (되돌리기 어려운 판단은 늘 멈춘다)
export function ChatRuntimeForm({
  tool,
  chat: { model, effort, stopMode },
  busy,
  onSubmit,
}: {
  tool: string;
  chat: Pick<Chat, 'model' | 'effort' | 'stopMode'>;
  busy: boolean;
  onSubmit: (body: { model: string | null; effort: string | null; stop_mode?: string }) => void;
}) {
  const [typed, setTyped] = useState(model ?? '');
  const engine = useEngines().find((e) => e.name === tool);
  const efforts = engine?.efforts ?? [];
  const send = (next: { model?: string | null; effort?: string | null }) =>
    onSubmit({
      model: next.model !== undefined ? next.model || null : model,
      effort: next.effort !== undefined ? next.effort || null : effort,
    });

  return (
    <fieldset className="chat-runtime" aria-label="이 대화의 모델">
      {engine?.models ? (
        <select
          className="input small"
          aria-label="모델"
          value={model ?? ''}
          disabled={busy}
          onChange={(e) => send({ model: e.target.value })}
        >
          {engine.models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
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
      <select
        className="input small"
        aria-label="멈춤 기준"
        title="되돌리기 어려운 판단은 늘 멈춰요"
        value={stopMode}
        disabled={busy}
        onChange={(e) => onSubmit({ model, effort, stop_mode: e.target.value })}
      >
        {Object.entries(STOP_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </fieldset>
  );
}
