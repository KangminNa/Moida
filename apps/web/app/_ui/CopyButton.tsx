'use client';

import { useEffect, useRef, useState } from 'react';
import { DoneLabel } from './SaveButton';

/** 체크를 보이는 시간 (저장 버튼과 같다) */
const SHOW_MS = 1800;

// 복사 버튼 (2026-11-26 콘솔 인터랙션 3): 누르면 버튼이 잠깐 체크와 "복사됨"으로 바뀐다 (아래 알림을 따로 띄우지 않는다).
// https가 아닌 주소(내부망 IP 등)에서는 브라우저가 클립보드를 주지 않아 "복사 못 함"과 까닭을 보인다
export function CopyButton({
  text,
  label = '복사',
  className = 'ghost',
}: {
  /** 복사할 글자. 누를 때 정해지는 것(지금 주소가 붙는 링크)은 함수로 */
  text: string | (() => string);
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function show(next: 'done' | 'failed') {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), SHOW_MS);
  }

  function copy() {
    if (!navigator.clipboard) return show('failed');
    navigator.clipboard.writeText(typeof text === 'string' ? text : text()).then(
      () => show('done'),
      () => show('failed'),
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={copy}
      title={
        state === 'failed' ? 'https 주소에서만 복사돼요. 글자를 골라 직접 복사해 주세요' : undefined
      }
    >
      {state === 'done' ? (
        <DoneLabel text="복사됨" />
      ) : state === 'failed' ? (
        <span role="status">복사 못 함</span>
      ) : (
        label
      )}
    </button>
  );
}
