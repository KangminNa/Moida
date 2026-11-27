'use client';

import { type ApiReply, api } from './client-api';

// 이 브라우저의 푸시 구독 (7단계, 2026-11-27 알림 칸에서도 켜기). 설정 › 알림의 "이 브라우저"와 독의 알림 칸이 함께 쓴다.
// 서비스 워커(/sw.js)를 깔고 서버의 공개 키로 구독해 서버에 맡긴다. 서버 키를 바꾸면 공개 키가 달라져 구독이 끊긴다(stale).

/** 이 브라우저의 푸시 상태 */
export type PushState = 'loading' | 'unsupported' | 'denied' | 'off' | 'on' | 'stale';

/** base64url → 바이트 (pushManager.subscribe의 applicationServerKey) */
function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** 구독이 지금 서버 키로 만든 것인가 */
function sameKey(subscription: PushSubscription, key: string): boolean {
  const used = subscription.options.applicationServerKey;
  if (!used) return false;
  const a = new Uint8Array(used);
  const b = bytesOf(key);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** 지금 상태와 구독 (서버의 공개 키와 맞춰 본다) */
export async function readPush(
  key: string,
): Promise<{ state: PushState; subscription: PushSubscription | null }> {
  if (!supported()) return { state: 'unsupported', subscription: null };
  if (Notification.permission === 'denied') return { state: 'denied', subscription: null };
  const registration = await navigator.serviceWorker.getRegistration('/');
  const found = (await registration?.pushManager.getSubscription()) ?? null;
  if (!found) return { state: 'off', subscription: null };
  return { state: sameKey(found, key) ? 'on' : 'stale', subscription: found };
}

/** 권한을 묻고 구독해 서버에 맡긴다. 실패는 화면이 그대로 보일 문구로 (useAction의 send) */
export async function subscribePush(key: string): Promise<ApiReply<unknown>> {
  const fail = (message: string): ApiReply<unknown> => ({
    ok: false,
    status: 0,
    error: { code: 'push', message },
  });
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return fail('브라우저 설정에서 이 사이트의 알림을 허용해 주세요');
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    // 서버 키가 바뀐 옛 구독은 브라우저와 서버 양쪽에서 지운다 (남겨 두면 실패를 다섯 번 쌓아야 지워진다)
    const old = await registration.pushManager.getSubscription();
    if (old) {
      await old.unsubscribe();
      await api('POST', '/api/push/subscriptions/delete', { endpoint: old.endpoint });
    }
    const made = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytesOf(key),
    });
    const reply = await api('POST', '/api/push/subscriptions', made.toJSON());
    if (!reply.ok) await made.unsubscribe();
    return reply;
  } catch (error) {
    return fail(`알림을 켜지 못했어요: ${(error as Error).message}`);
  }
}
