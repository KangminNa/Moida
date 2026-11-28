'use client';

import { useEffect, useState } from 'react';

/** 글자 크기 단계 → 화면 이름. 보통은 html에 표시를 두지 않는다 (globals.css의 html[data-text]) */
const STEPS = [
  ['small', '작게'],
  ['normal', '보통'],
  ['large', '크게'],
] as const;

// 글자 크기 고르기 (설정 옆 칸 아래, 화면 밝기 옆). 고른 값은 이 브라우저에만 남는다 (화면 밝기와 같다).
// 첫 그림 전에는 layout.tsx의 스크립트가 같은 값을 html에 붙인다.
export function TextSize() {
  const [step, setStep] = useState<string>('normal');

  useEffect(() => {
    setStep(document.documentElement.dataset.text ?? 'normal');
  }, []);

  function pick(next: string) {
    if (next === 'normal') delete document.documentElement.dataset.text;
    else document.documentElement.dataset.text = next;
    try {
      if (next === 'normal') localStorage.removeItem('moida-text');
      else localStorage.setItem('moida-text', next);
    } catch {
      // 저장이 막힌 브라우저에서는 지금 화면에만 적용한다
    }
    setStep(next);
  }

  return (
    <fieldset className="text-size">
      <legend className="sr">글자 크기</legend>
      {STEPS.map(([value, label]) => (
        <button key={value} type="button" aria-pressed={step === value} onClick={() => pick(value)}>
          {label}
        </button>
      ))}
    </fieldset>
  );
}
