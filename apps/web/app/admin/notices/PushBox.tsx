'use client';

import { useCallback, useEffect, useState } from 'react';
import { type PushState, readPush, subscribePush } from '../../_lib/browser-push';
import { api, describe } from '../../_lib/client-api';
import type { PushKey, PushTest } from '../../_platform/types';
import { useNotify } from '../../_ui/notify';

const STATE_LABELS: Record<PushState, string> = {
  loading: '확인 중…',
  unsupported: '받을 수 없음',
  denied: '막아 둠',
  off: '받지 않는 중',
  on: '받는 중',
  stale: '다시 켜야 함',
};

/** 상태마다 덧붙이는 안내 */
const STATE_HINTS: Partial<Record<PushState, string>> = {
  unsupported: '푸시를 받을 수 없는 브라우저예요',
  denied: '브라우저 설정에서 이 사이트의 알림을 허용해 주세요',
  stale: '서버 키가 바뀌어 지난 구독으로는 받을 수 없어요',
};

// 이 브라우저에서 푸시 받기 (7단계). 구독 · 상태는 _lib/browser-push (독의 알림 칸과 함께 쓴다).
// 서버 키를 바꾸면 공개 키가 달라져 구독이 끊긴다: 그때는 "다시 켜기".
export function PushBox() {
  const notify = useNotify();
  const [state, setState] = useState<PushState>('loading');
  const [key, setKey] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const check = useCallback(async () => {
    const reply = await api<PushKey>('GET', '/api/push/key');
    if (!reply.ok) return setProblem(describe(reply.error));
    setKey(reply.data.publicKey);
    const found = await readPush(reply.data.publicKey);
    setSubscription(found.subscription);
    setState(found.state);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function turnOn() {
    if (!key) return;
    setBusy(true);
    setProblem(null);
    const reply = await subscribePush(key);
    setBusy(false);
    if (reply.ok) notify('이 브라우저로 알림을 받아요');
    else setProblem(describe(reply.error));
    await check();
  }

  async function turnOff() {
    if (!subscription) return;
    setBusy(true);
    setProblem(null);
    const { endpoint } = subscription;
    await subscription.unsubscribe().catch(() => false);
    const reply = await api('POST', '/api/push/subscriptions/delete', { endpoint });
    setBusy(false);
    if (!reply.ok) setProblem(describe(reply.error));
    else notify('이 브라우저로 알림을 받지 않아요');
    await check();
  }

  async function test() {
    if (!subscription) return;
    setBusy(true);
    setProblem(null);
    const reply = await api<PushTest>('POST', '/api/push/test', {
      endpoint: subscription.endpoint,
    });
    setBusy(false);
    if (!reply.ok) return setProblem(describe(reply.error));
    if (reply.data.sent > 0) notify('보냈어요. 잠시 뒤 알림이 떠요');
    else setProblem('푸시 서비스가 받지 않았어요. 다시 켜 보세요');
    await check();
  }

  return (
    <section className="panel stack" aria-label="이 브라우저">
      <div className="sec-title flat">
        <h2>이 브라우저</h2>
        <span className={state === 'on' ? 'pill on' : 'pill'}>{STATE_LABELS[state]}</span>
      </div>
      <p className="note">
        푸시는 브라우저마다 따로 켜요. 아이폰 · 아이패드는 이 사이트를 홈 화면에 추가한 앱에서만
        받아요
      </p>
      {STATE_HINTS[state] && <p className="note">{STATE_HINTS[state]}</p>}
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        {(state === 'off' || state === 'stale') && (
          <button type="button" className="cta small" disabled={busy || !key} onClick={turnOn}>
            {state === 'stale' ? '다시 켜기' : '알림 받기'}
          </button>
        )}
        {state === 'on' && (
          <>
            <button type="button" className="ghost" disabled={busy} onClick={test}>
              테스트 알림
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={turnOff}>
              끄기
            </button>
          </>
        )}
      </div>
    </section>
  );
}
