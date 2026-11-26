'use client';

import { useRef, useState } from 'react';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { useLiveValue } from '../../../_lib/use-live';
import { when } from '../../../_task/labels';
import type { Output, OutputShare, OutputShareList } from '../../../_task/types';
import { CopyButton } from '../../../_ui/CopyButton';
import { NewTabLink } from '../../../_ui/NewTabLink';
import { useNotify } from '../../../_ui/notify';

/** 고를 수 있는 기간 (서버의 OutputShare.DAYS). 처음 값은 7일 */
const DAYS: readonly [number, string][] = [
  [1, '1일'],
  [7, '7일'],
  [30, '30일'],
];

// 결과물 공유 링크 (기획서 결정 2026-11-19): 로그인 없이 볼 수 있는 링크를 기간을 정해 연다. 끄면 바로 닫힌다.
// output이 있으면 그 결과물의 링크 · 만들기(공유 칸), 없으면 공간에서 공유 중인 링크 전부 (결과물 메뉴 위, 없으면 그리지 않는다).
// 링크는 서버가 읽을 때마다 같은 주소로 다시 만들어 주므로 언제든 다시 복사할 수 있다
export function OutputSharePanel({
  output,
  onClose,
}: {
  output: Output | null;
  onClose?: () => void;
}) {
  const path = output ? `/api/output-shares?outputId=${output.id}` : '/api/output-shares';
  const list = useLiveValue(path, () => api<OutputShareList>('GET', path), []);
  const action = useAction();
  const notify = useNotify();
  const [days, setDays] = useState(7);
  /** 만들기의 requestId: 응답을 못 받아 다시 눌러도 링크 하나 */
  const requestId = useRef(crypto.randomUUID());
  const shares = list.data?.shares ?? [];
  const busy = action.busy !== null;

  /** 복사. https가 아닌 주소(내부망 IP 등)에서는 브라우저가 클립보드를 주지 않는다 */
  function copy(share: OutputShare) {
    const failed = () => notify('복사하지 못했어요. 링크 열기에서 주소를 복사해 주세요');
    if (!navigator.clipboard) return failed();
    navigator.clipboard
      .writeText(`${location.origin}${share.path}`)
      .then(() => notify('링크를 복사했어요'), failed);
  }

  async function create() {
    if (!output) return;
    const reply = await action.run(
      'create',
      () =>
        api<OutputShare>('POST', '/api/output-shares', {
          requestId: requestId.current,
          outputId: output.id,
          days,
        }),
      { reload: list.reload },
    );
    if (!reply?.ok) return;
    requestId.current = crypto.randomUUID();
    copy(reply.data);
  }

  const end = (share: OutputShare) => {
    if (!window.confirm('공유를 끌까요? 이 링크는 다시 켤 수 없어요. 새로 만들면 주소가 달라져요'))
      return;
    void action.run(
      share.id,
      () => api<OutputShare>('POST', `/api/output-shares/${share.id}/end`),
      { done: '공유를 껐어요', reload: list.reload },
    );
  };

  if (!output && shares.length === 0) return null;
  return (
    <section className="panel" aria-label={output ? `공유: ${output.name}` : '공유 중인 링크'}>
      <div className="sec-title flat">
        <h2>{output ? `공유 · ${output.name}` : `공유 중인 링크 ${shares.length}개`}</h2>
        {onClose && (
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
        )}
      </div>
      {output && (
        <>
          <p className="note">로그인 없이 링크를 아는 누구나 열 수 있음. 끄면 바로 닫힘</p>
          <div className="row">
            <select
              className="input"
              aria-label="공유 기간"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {DAYS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" className="cta small" disabled={busy} onClick={create}>
              {action.busy === 'create' ? '만드는 중' : '링크 만들기'}
            </button>
          </div>
        </>
      )}
      {(action.problem ?? list.error) && <p className="error">{action.problem ?? list.error}</p>}
      {shares.length > 0 && (
        <ul className="list" aria-label="공유 링크">
          {shares.map((s) => (
            <li key={s.id} className="list-cell output-row">
              <div className="output-main">
                {!output && <b>{s.outputName}</b>}
                <small>
                  <NewTabLink href={s.path}>링크 열기</NewTabLink> · {when(s.expiresAt)}까지
                </small>
              </div>
              <div className="row">
                <CopyButton text={() => `${location.origin}${s.path}`} />
                <button type="button" className="ghost" disabled={busy} onClick={() => end(s)}>
                  끄기
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
