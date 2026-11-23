'use client';

import { useState } from 'react';

/**
 * 목록에서 여럿 고르기 (2026-11-23 일괄 지우기: 작업 기록 · 보관함). 고른 열쇠의 모음과 고르기 · 풀기.
 * 목록이 바뀌어도 고른 것은 남는다: 동작이 끝나면 부르는 쪽이 clear한다
 */
export function usePicks() {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  return {
    picked,
    size: picked.size,
    has: (key: string) => picked.has(key),
    toggle: (key: string) =>
      setPicked((before) => {
        const next = new Set(before);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    all: (keys: readonly string[]) => setPicked(new Set(keys)),
    clear: () => setPicked(new Set()),
  };
}
