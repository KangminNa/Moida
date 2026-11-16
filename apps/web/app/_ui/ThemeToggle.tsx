'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

// 밝은 화면 · 어두운 화면 전환 (선 아이콘 달 · 해). 고른 값은 이 브라우저에만 남고, 고르지 않으면 기기 설정을 따른다.
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const mode = getComputedStyle(document.documentElement).getPropertyValue('--mode');
    setDark(mode.trim() === 'dark');
  }, []);

  function toggle() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('cairn-theme', next);
    } catch {
      // 저장이 막힌 브라우저에서는 지금 화면에만 적용한다
    }
    setDark(!dark);
  }

  return (
    <button
      type="button"
      className="icon-button"
      onClick={toggle}
      disabled={dark === null}
      aria-label={dark ? '밝은 화면으로' : '어두운 화면으로'}
      title={dark ? '밝은 화면으로' : '어두운 화면으로'}
    >
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}
