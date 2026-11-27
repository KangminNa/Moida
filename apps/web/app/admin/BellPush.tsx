'use client';

import { useEffect, useState } from 'react';
import { type PushState, readPush, subscribePush } from '../_lib/browser-push';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { useLiveValue } from '../_lib/use-live';
import type { PushKey } from '../_platform/types';

// 알림 칸 맨 위의 "이 브라우저로 알림 받기" (2026-11-27, 사용자 "브라우저에 알림이 안 와").
// 푸시는 브라우저마다 한 번 구독해야 오는데, 켜는 곳이 설정 › 알림 안에만 있어 모르고 지나쳤다.
// 받는 중이면 아무것도 보이지 않는다. 막아 둔 브라우저 · 받을 수 없는 브라우저는 까닭을 한 줄로
export function BellPush() {
  const action = useAction();
  const key = useLiveValue('push-key', () => api<PushKey>('GET', '/api/push/key'), []);
  const publicKey = key.data?.publicKey ?? null;
  const [state, setState] = useState<PushState>('loading');

  useEffect(() => {
    if (publicKey) void readPush(publicKey).then((found) => setState(found.state));
  }, [publicKey]);

  async function turnOn() {
    if (!publicKey) return;
    await action.run('push', () => subscribePush(publicKey), {
      done: '이 브라우저로 알림을 받아요',
    });
    setState((await readPush(publicKey)).state);
  }

  if (state === 'loading' || state === 'on') return null;
  return (
    <div className="bell-push">
      {state === 'denied' && <small>브라우저 설정에서 이 사이트의 알림을 허용해 주세요</small>}
      {state === 'unsupported' && (
        <small>이 브라우저는 알림을 받지 못해요. 아이폰은 홈 화면에 추가한 앱에서 받아요</small>
      )}
      {(state === 'off' || state === 'stale') && (
        <>
          <small>
            {state === 'stale' ? '서버 키가 바뀌어 다시 켜야 해요' : '창을 닫아도 알림 받기'}
          </small>
          <button
            type="button"
            className="cta small"
            disabled={action.busy !== null}
            onClick={turnOn}
          >
            {state === 'stale' ? '다시 켜기' : '브라우저 알림 받기'}
          </button>
        </>
      )}
      {action.problem && <small className="error">{action.problem}</small>}
    </div>
  );
}
