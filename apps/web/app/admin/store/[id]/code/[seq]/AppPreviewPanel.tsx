'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAppCode, useApps } from '../../../../../_blog/live';
import type { AppCodeChanges, AppCodePreview, AppCodeState } from '../../../../../_blog/types';
import { api } from '../../../../../_lib/client-api';
import { useAction } from '../../../../../_lib/use-action';
import { useLiveValue } from '../../../../../_lib/use-live';
import { NewTabLink } from '../../../../../_ui/NewTabLink';
import { STORE_HREF } from '../../../../menu';

/** 앱 화면의 격리와 같다 (틀에도 한 번 더): 앱의 스크립트는 콘솔과 로그인에 닿지 못한다 */
const FRAME_SANDBOX =
  'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';
const CONFLICT = '이미 바뀐 앱이에요. 최신 내용을 다시 읽었어요';

type Width = 'desktop' | 'phone';

// 앱 코드 미리 보기 (스토어 1-6): 버전 하나를 토큰 주소(/<앱>/~<토큰>, 30분)로 격리된 틀에 연다.
// seq: 버전 번호 · 0(시작 코드) · null(지금 보이는 코드). 확인 대기 버전이면 "이 버전 공개"로 방문자에게 보인다.
export function AppPreviewPanel({ id, seq }: { id: string; seq: number | null }) {
  const apps = useApps();
  const code = useAppCode(id);
  const action = useAction();
  const [width, setWidth] = useState<Width>('desktop');
  const preview = useLiveValue(
    `app-preview:${id}:${seq ?? 'live'}`,
    () => api<AppCodePreview>('POST', `/api/apps/${id}/code/preview`, seq === null ? {} : { seq }),
    [],
  );
  const changes = useLiveValue(
    `app-code-changes:${id}:${seq ?? 0}`,
    () =>
      seq !== null && seq > 0
        ? api<AppCodeChanges>('GET', `/api/apps/${id}/code/versions/${seq}/changes`)
        : Promise.resolve({ ok: true as const, data: null }),
    [],
  );
  const app = apps.data?.apps.find((a) => a.id === id) ?? null;
  const c = code.data;
  const problem = action.problem ?? preview.error ?? code.error ?? apps.error;

  const label = seq === null ? '지금 보이는 코드' : seq === 0 ? '시작 코드' : `버전 ${seq}`;
  const state =
    c === null
      ? null
      : seq === null || seq === (c.current ?? 0)
        ? '공개 중'
        : seq === c.pending
          ? '확인 대기 · 방문자에게 안 보임'
          : '방문자에게 안 보임';
  const canShow = c !== null && seq !== null && seq > 0 && seq !== c.current;

  function show() {
    if (!c || seq === null) return;
    void action.run(
      'show',
      () => api<AppCodeState>('POST', `/api/apps/${id}/code/current`, { version: c.version, seq }),
      { done: `버전 ${seq} 공개 중`, reload: code.reload, conflict: CONFLICT },
    );
  }

  const url = preview.data?.url ?? null;
  const diff = changes.data;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>
            {app?.name ?? '앱'} · {label}
          </h1>
          <p>
            <Link href={`${STORE_HREF}/${id}?tab=code`}>← 코드</Link>
            {state && ` · ${state}`}
          </p>
        </div>
        <div className="row">
          <fieldset className="chips">
            <legend className="sr">너비</legend>
            {(['desktop', 'phone'] as const).map((w) => (
              <button
                key={w}
                type="button"
                className="chip"
                aria-pressed={width === w}
                onClick={() => setWidth(w)}
              >
                {w === 'desktop' ? '데스크톱' : '폰'}
              </button>
            ))}
          </fieldset>
          {url && (
            <NewTabLink className="ghost small" href={url}>
              새 창
            </NewTabLink>
          )}
          {canShow && (
            <button
              type="button"
              className="cta small"
              disabled={action.busy !== null}
              onClick={show}
            >
              이 버전 공개
            </button>
          )}
        </div>
      </header>
      {problem && <p className="error">{problem}</p>}
      {diff && (
        <p className="note">
          {diff.base === 0 ? '시작 코드' : `버전 ${diff.base}`}와 비교: 바뀜{' '}
          {diff.changed.join(' · ') || '없음'} · 더함 {diff.added.join(' · ') || '없음'} · 지움{' '}
          {diff.removed.join(' · ') || '없음'}
          {diff.hostsAdded.length > 0 && ` · 새 바깥 주소 ${diff.hostsAdded.join(' · ')}`}
        </p>
      )}
      {url ? (
        <iframe
          key={url}
          className={`page-frame app-preview ${width}`}
          title={`${app?.name ?? '앱'} ${label}`}
          src={url}
          sandbox={FRAME_SANDBOX}
        />
      ) : (
        !problem && <p className="label-mono">불러오는 중…</p>
      )}
    </>
  );
}
