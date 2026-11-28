'use client';

import { useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useConnectorPresets } from '../../_task/live';

// 추천 커넥터 (C2, 2026-11-28): 서비스가 공개한 공식 원격 MCP를 저장소의 목록에서 골라 한 번에 더한다.
// 더하면 모든 일꾼에게 허락되고, OAuth는 아래 목록의 "로그인", 토큰 방식은 "토큰 넣기"로 마친다. 연결 확인이 실제로 붙는지 본다
export function ConnectorPresets() {
  const presets = useConnectorPresets();
  const action = useAction();
  /** 더하기를 누를 때마다 새 요청 id (같은 누름을 다시 보내면 하나) */
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const list = presets.data?.presets ?? null;

  async function add(key: string) {
    const reply = await action.run(
      `preset:${key}`,
      () => api('POST', `/api/external-tools/presets/${key}`, { requestId }),
      { done: '커넥터를 더했어요' },
    );
    if (reply?.ok) setRequestId(crypto.randomUUID());
  }

  if (list === null || list.every((p) => p.added)) return null;
  return (
    <section className="result" aria-label="추천 커넥터">
      <b>추천 커넥터</b>
      {(action.problem ?? presets.error) && (
        <p className="error">{action.problem ?? presets.error}</p>
      )}
      <ul className="list">
        {list
          .filter((p) => !p.added)
          .map((p) => (
            <li key={p.key} className="list-row" style={{ cursor: 'default' }}>
              <span>
                <b>{p.title}</b>
                <small>{[p.does, p.auth === 'oauth' ? 'OAuth 로그인' : '토큰'].join(' · ')}</small>
                {p.setup && <small>{p.setup}</small>}
              </span>
              <button
                type="button"
                className="ghost"
                disabled={action.busy !== null}
                onClick={() => add(p.key)}
              >
                더하기
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}
