import { useCallback, useEffect, useState } from 'react';
import type { BuildSeed, Call, Suggestion } from './browser-types';

// 되풀이되는 일 (2026-11-16 MCP 3단계): 같은 사이트에서 같은 모양의 브라우저 일이 14일 안에 세 번이면 제안한다.
// 승인한 누르기 계획으로 누른 일에서 쓰기 API가 기록되면 바로 제안한다 (2026-11-21, note에 까닭. 폼은 쓰기 모드로 연다).
// "도구로 만들기"는 아래 폼을 사이트 · 힌트(예시 지시)로 채워 연다. "그만 보기"면 다시 내지 않는다.
// 되풀이 읽기 일은 서버가 묻지 않고 굳힌다 (2026-11-24, 설정 autoRepeatTools): 여기에는 쓰기 제안 · 설정을 끈 때 · 그 사이트가
// 다른 도구를 굳히는 중이라 기다리는 제안만 남는다

export function Suggestions({
  call,
  notify,
  onPick,
}: {
  call: Call;
  notify: (text: string) => void;
  onPick: (seed: BuildSeed) => void;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const reply = await call('GET', 'suggestions');
    if (reply.ok) setItems((reply.data as { suggestions: Suggestion[] }).suggestions);
    else notify(reply.message);
  }, [call, notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function dismiss(item: Suggestion) {
    setBusy(item.id);
    const reply = await call('POST', `suggestions/${item.id}/dismiss`, { version: item.version });
    setBusy(null);
    if (!reply.ok) return notify(reply.message);
    setItems((reply.data as { suggestions: Suggestion[] }).suggestions);
  }

  if (items.length === 0) return null;
  return (
    <section className="panel" aria-label="도구로 만들 만한 일">
      <b>도구로 만들 만한 일</b>
      <p className="note">
        승인한 계획으로 누른 일에 쓰기 API가 있거나, 아직 도구가 되지 않은 되풀이 일이에요. 도구로
        만들면 다음부터 AI 없이 몇 초에 끝나요 (쓰기 도구는 부를 때마다 승인)
      </p>
      <ul className="list">
        {items.map((s) => (
          <li key={s.id} className="stack">
            <span className="label-mono">
              {s.siteName || '지운 사이트'} ·{' '}
              {s.note ? '승인한 계획에서 기록한 쓰기 API' : `14일 안에 ${s.count}번`}
            </span>
            <span className="text">{s.sample}</span>
            {s.note && <span className="note">{s.note}</span>}
            <div className="row">
              <button
                type="button"
                className="ghost small fit"
                onClick={() =>
                  onPick({
                    key: s.id,
                    siteId: s.siteId,
                    hint: s.note
                      ? `${s.note}\n지시 예:\n${s.sample}`
                      : `되풀이된 지시 예:\n${s.sample}`,
                    suggestionId: s.id,
                    mode: s.note ? 'write' : 'read',
                  })
                }
              >
                도구로 만들기
              </button>
              <button
                type="button"
                className="ghost small fit"
                disabled={busy !== null}
                onClick={() => dismiss(s)}
              >
                그만 보기
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
