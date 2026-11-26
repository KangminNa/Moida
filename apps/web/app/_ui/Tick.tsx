'use client';

import { type ReactNode, useRef } from 'react';

// 숫자가 바뀌면 새 값이 아래에서 살짝 올라온다 (2026-11-26 콘솔 인터랙션 5): 승인 대기 · 안 읽은 알림 · 대화 토큰.
// 값이 바뀔 때마다 key가 바뀌어 span이 새로 그려지고 globals.css의 .tick 움직임이 다시 돈다.
// 처음 그릴 때는 움직이지 않는다 (화면을 열 때마다 숫자가 튀지 않게). 움직임 줄이기면 그대로
export function Tick({ value, children }: { value: string | number; children?: ReactNode }) {
  const first = useRef(value);
  return (
    <span key={String(value)} className={first.current === value ? undefined : 'tick'}>
      {children ?? value}
    </span>
  );
}
