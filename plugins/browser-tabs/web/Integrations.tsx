import { useCallback, useEffect, useState } from 'react';
import type { BuildSeed, Integration, Props } from './browser-types';
import { IntegrationDetailPanel } from './IntegrationDetailPanel';
import { IntegrationForm } from './IntegrationForm';
import { Suggestions } from './Suggestions';

// 사이트 도구 (2026-11-16 MCP 2단계): 되풀이하는 읽기 일을 Playwright 코드로 굳힌 것. 에이전트가 site_run으로 부르면
// 서버 러너가 AI 없이 돌린다. 켜기는 승인 화면(켜기 승인)이나 여기서, 연속 실패면 고장으로 멈추고 고치기로 다시 굳힌다

const STATUS: Record<string, string> = {
  building: '만드는 중',
  reviewing: '검토 중',
  review: '켜기 대기',
  on: '켜짐',
  broken: '고장',
  off: '꺼짐',
};

export function Integrations({ call, notify }: Props) {
  const [items, setItems] = useState<Integration[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seed, setSeed] = useState<BuildSeed | null>(null);

  const load = useCallback(async () => {
    const reply = await call('GET', 'integrations');
    if (reply.ok) setItems((reply.data as { integrations: Integration[] }).integrations);
    else notify(reply.message);
  }, [call, notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(item: Integration, method: string, path: string, done: string, body = {}) {
    setBusy(item.id);
    const reply = await call(method, path, { version: item.version, ...body });
    setBusy(null);
    notify(reply.ok ? done : reply.message);
    load();
  }

  const remove = (item: Integration) => {
    if (!window.confirm(`${item.title} 도구를 삭제할까요? 버전과 실행 기록도 함께 지워져요`))
      return;
    act(item, 'DELETE', `integrations/${item.id}`, '도구를 삭제했어요');
  };

  return (
    <section className="stack" aria-label="사이트 도구">
      <div className="row">
        <b>사이트 도구</b>
        <button type="button" className="ghost small fit" onClick={() => load()}>
          새로고침
        </button>
      </div>
      <p className="note">
        에이전트는 사이트에서 정보를 찾을 때 켜진 도구를 먼저 써요. 실패하면 브라우저 담당이
        대신해요. 자주 하는 읽기 일과 기록된 API는 저절로 도구가 돼요(repeat_ · api_). 필요 없는
        도구는 지우면 다시 만들지 않아요
      </p>
      <Suggestions call={call} notify={notify} onPick={setSeed} />
      <IntegrationForm
        key={seed?.key ?? 'new'}
        call={call}
        notify={notify}
        seed={seed}
        onMade={() => {
          setSeed(null);
          load();
        }}
      />
      {items === null ? (
        <p className="note">불러오는 중</p>
      ) : items.length === 0 ? (
        <p className="note">아직 도구 없음</p>
      ) : (
        <ul className="list">
          {items.map((t) => (
            <li key={t.id} className="panel">
              <b>
                {t.title} <span className="pill">{STATUS[t.status] ?? t.status}</span>
                {t.mode === 'write' && <span className="pill strong">쓰기</span>}
              </b>
              <span className="label-mono">
                {t.name} · {t.siteName || '지운 사이트'}
                {t.liveSeq ? ` · 버전 ${t.liveSeq}` : ''} · 성공 {t.runsOk} · 실패 {t.runsFailed}
              </span>
              <span className="note">{t.description}</span>
              {t.lastError && <span className="note">마지막 오류: {t.lastError}</span>}
              {t.review && (
                <span className="note">
                  검토(버전 {t.review.seq}): {t.review.verdict === 'pass' ? '통과' : '고칠 점'}
                  {t.review.notes ? ` · ${t.review.notes}` : ''}
                </span>
              )}
              <div className="row">
                {t.draftSeq !== null && t.status !== 'on' && t.status !== 'building' && (
                  <button
                    type="button"
                    className="ghost small fit"
                    disabled={busy !== null}
                    onClick={() => act(t, 'POST', `integrations/${t.id}/enable`, '켰어요')}
                  >
                    켜기
                  </button>
                )}
                {t.status !== 'off' && t.status !== 'building' && (
                  <button
                    type="button"
                    className="ghost small fit"
                    disabled={busy !== null}
                    onClick={() => act(t, 'POST', `integrations/${t.id}/off`, '껐어요')}
                  >
                    끄기
                  </button>
                )}
                {t.status !== 'on' && t.status !== 'building' && t.status !== 'reviewing' && (
                  <button
                    type="button"
                    className="ghost small fit"
                    disabled={busy !== null}
                    onClick={() =>
                      act(t, 'POST', `integrations/${t.id}/build`, '고치기를 맡겼어요', {
                        requestId: crypto.randomUUID(),
                      })
                    }
                  >
                    고치기
                  </button>
                )}
                <button
                  type="button"
                  className="ghost small fit"
                  onClick={() => setOpen(open === t.id ? null : t.id)}
                >
                  {open === t.id ? '접기' : '자세히'}
                </button>
                {t.status !== 'building' && (
                  <button
                    type="button"
                    className="ghost small fit"
                    disabled={busy !== null}
                    onClick={() => remove(t)}
                  >
                    삭제
                  </button>
                )}
              </div>
              {open === t.id && <IntegrationDetailPanel call={call} id={t.id} notify={notify} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
