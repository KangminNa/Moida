'use client';

import { useEffect } from 'react';

// 뒤로 가기로 되살아난 콘솔 (웹 UX U1): 브라우저가 지난 화면을 메모리(bfcache)에서 그대로 꺼내면 서버를 거치지 않아,
// 로그아웃한 뒤에도 콘솔이 잠깐 보일 수 있다. 되살아났을 때(pageshow persisted) 로그인을 물어 끝났으면 로그인 화면으로 바꿔치기한다.
// 로그인이 살아 있으면 그대로 둔다 (뒤로 가기가 빠른 채로). 메모리에서 꺼낸 화면은 듣던 이벤트도 그대로라 콘솔 틀의 훅으로 둔다
// (인라인 스크립트는 나중에 CSP script-src를 걸면 막힌다)

export function useConsoleRestore() {
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      fetch('/api/auth/me', { cache: 'no-store' })
        .then((reply) => {
          if (reply.status !== 401 && reply.status !== 403) return;
          const back = `${location.pathname}${location.search}`;
          location.replace(`/login?return=${encodeURIComponent(back)}`);
        })
        // 서버에 닿지 않으면 그대로 둔다: 다음 요청이 로그인을 다시 묻는다
        .catch(() => {});
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
}
