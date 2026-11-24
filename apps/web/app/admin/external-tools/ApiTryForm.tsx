'use client';

import { type FormEvent, useRef, useState } from 'react';
import type { ApiConnector } from '../../_task/types';

/** 시험의 입력 (POST /api/api-connectors/:id/try). requestId는 같은 내용을 다시 보낼 때 같게 */
export type ApiTryBody = { requestId: string; operation: string; input: Record<string, unknown> };

// API 커넥터의 시험 (2026-11-24): 동작 하나를 고르고 입력(JSON)을 넣어 관리자가 직접 부른다.
// 관리자가 누른 것이 승인이라 쓰기 · 돈이 드는 동작도 바로 간다 (돈이 드는 동작은 하루 한도에 센다)
export function ApiTryForm({
  connector,
  busy,
  problem,
  onSubmit,
  onEdit,
}: {
  connector: ApiConnector;
  busy: boolean;
  problem: string | null;
  onSubmit: (body: ApiTryBody) => Promise<boolean>;
  onEdit: () => void;
}) {
  const [operation, setOperation] = useState(connector.operations[0]?.name ?? '');
  const [input, setInput] = useState('{}');
  const [bad, setBad] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const chosen = connector.operations.find((o) => o.name === operation);

  function change(apply: () => void) {
    requestId.current = null;
    setBad(null);
    onEdit();
    apply();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(input || '{}');
    } catch {
      setBad('입력은 JSON 객체예요');
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setBad('입력은 JSON 객체예요');
      return;
    }
    if (
      chosen?.effect !== 'read' &&
      !window.confirm(`${chosen?.title}: 바깥 서비스에서 실제로 실행돼요 (돈이 들 수 있어요)`)
    )
      return;
    requestId.current ??= crypto.randomUUID();
    await onSubmit({
      requestId: requestId.current,
      operation,
      input: parsed as Record<string, unknown>,
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        <span>동작</span>
        <select
          className="input"
          value={operation}
          onChange={(e) => change(() => setOperation(e.target.value))}
        >
          {connector.operations.map((o) => (
            <option key={o.name} value={o.name}>
              {o.title} ({o.method} {o.path})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>입력 (JSON)</span>
        <textarea
          className="input mono"
          rows={4}
          value={input}
          onChange={(e) => change(() => setInput(e.target.value))}
        />
      </label>
      {(bad ?? problem) && <p className="error">{bad ?? problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy || !chosen}>
          시험으로 부르기
        </button>
      </div>
    </form>
  );
}
