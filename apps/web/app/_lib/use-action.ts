'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotify } from '../_ui/notify';
import { type ApiReply, describe } from './client-api';

/** 동작 하나가 끝난 뒤 할 일 */
export type ActionPlan<T> = {
  /** 끝나면 아래 한 줄 알림 */
  done?: string | ((data: T) => string);
  /** 끝난 뒤, 그리고 409일 때 다시 읽는다 */
  reload?: () => unknown;
  /**
   * 본 version이 낡았을 때(서버가 `stale`로 알린 409)의 문구. 서버의 문구에는 버전 번호가 들어 있어 화면의 말로 바꾼다.
   * 다른 뜻의 409(이름이 겹침 · 남은 것이 있어 못 지움 · 아직 도는 중)는 이 문구를 주어도 서버의 문구를 그대로 보인다:
   * 못 한 까닭이 "이미 바뀌었어요"로 가려지지 않게
   */
  conflict?: string;
};

export type Action = {
  /** 도는 중인 동작의 이름. 없으면 null (줄마다 버튼이 있으면 그 줄의 id를 이름으로) */
  busy: string | null;
  /** 마지막 동작의 오류 문구 */
  problem: string | null;
  /** 방금 끝난 동작의 이름 (잠깐만, 저장 버튼의 체크: `_ui/SaveButton`). 없으면 null */
  done: string | null;
  /** 오류 문구를 지운다 (폼을 닫을 때) */
  clear(): void;
  /** 동작 하나를 돌린다. 다른 동작이 도는 중이면 하지 않고 null */
  run<T>(
    name: string,
    send: () => Promise<ApiReply<T>>,
    plan?: ActionPlan<T>,
  ): Promise<ApiReply<T> | null>;
};

/** 끝난 체크를 보이는 시간 */
const DONE_MS = 1800;

// 화면의 쓰기 동작 (web 규칙: 쓰기는 useAction). 누름 → 바쁨 표시 → 호출 → 오류 문구나 알림 → 다시 읽기.
// 패널마다 busy · problem 상태와 409 처리(다시 읽기)를 손으로 쓰지 않게 한 곳에 둔다. 읽기는 useLiveValue.
// 보내기 전의 확인이 실패하면 send가 서버에 보내지 않고 실패 응답({ ok: false, … })을 돌려줘도 된다: 그 문구가 problem이 된다.
export function useAction(): Action {
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const running = useRef(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    },
    [],
  );

  const run = useCallback(
    async <T>(
      name: string,
      send: () => Promise<ApiReply<T>>,
      plan: ActionPlan<T> = {},
    ): Promise<ApiReply<T> | null> => {
      if (running.current) {
        // 누른 것이 말없이 사라지지 않게 (줄마다 버튼이 있는 목록에서 다른 줄의 동작이 도는 중)
        notify('앞 동작이 끝난 뒤 다시 눌러 주세요');
        return null;
      }
      running.current = true;
      setBusy(name);
      setProblem(null);
      setDone(null);
      try {
        const reply = await send();
        if (reply.ok) {
          // 버튼이 잠깐 체크로 바뀐다 (2026-11-26 콘솔 인터랙션 3). 폼이 key로 새로 만들어져도 패널이 들고 있다
          setDone(name);
          if (doneTimer.current) clearTimeout(doneTimer.current);
          doneTimer.current = setTimeout(() => setDone(null), DONE_MS);
          if (plan.done) notify(typeof plan.done === 'string' ? plan.done : plan.done(reply.data));
          await plan.reload?.();
        } else if (reply.status === 409) {
          await plan.reload?.();
          setProblem(reply.error.stale && plan.conflict ? plan.conflict : describe(reply.error));
        } else {
          setProblem(describe(reply.error));
        }
        return reply;
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [notify],
  );

  const clear = useCallback(() => setProblem(null), []);
  return { busy, problem, done, clear, run };
}
