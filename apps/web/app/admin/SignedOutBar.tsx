'use client';

import { useEffect, useState } from 'react';
import { DENIED_EVENT } from '../_lib/client-api';
import { loginPath } from '../_lib/return-path';

// 콘솔에서 로그인이 끝났을 때 (웹 UX U1 · U2). 로그인은 마지막으로 쓴 날부터 30일이라 쓰는 중에는 거의 끝나지 않고,
// 끝나는 때는 다른 곳에서 끝냈을 때(보안 화면 · 비밀번호 바꾸기)나 탭을 30일 넘게 열어 둔 때다.
//   쓰는 중 API가 401 · 403(로그인이 끝나면 관리 API는 403): 로그인이 정말 끝났는지 물어(지금 비밀번호 틀림처럼 살아 있어도 오는 답이 있다) 끝났으면
//     아래에 "로그인이 끝났어요 · 다시 로그인"을 띄운다. 바로 옮기지 않는다: 쓰던 글이 사라지지 않게. 다시 로그인하면 보던 주소로.
//   뒤로 가기로 메모리(bfcache)에서 되살아남: 서버를 거치지 않아 끝난 콘솔이 보일 수 있어, 끝났으면 로그인 화면으로 바꿔치기한다.
// 메모리에서 꺼낸 화면은 듣던 이벤트도 그대로라 콘솔 틀의 컴포넌트로 둔다 (인라인 스크립트는 나중에 CSP script-src를 걸면 막힌다)

/** 지금 화면의 주소 (다시 로그인하면 돌아올 곳) */
function here(): string {
  return `${location.pathname}${location.search}`;
}

/** 로그인이 끝났는가. 서버에 닿지 않으면 모른다(false): 다음 요청이 다시 묻는다 */
async function signedOut(): Promise<boolean> {
  try {
    const reply = await fetch('/api/auth/me', { cache: 'no-store' });
    return reply.status === 401 || reply.status === 403;
  } catch {
    return false;
  }
}

export function SignedOutBar() {
  const [back, setBack] = useState<string | null>(null);

  useEffect(() => {
    let asking = false;
    const denied = async () => {
      if (asking) return;
      asking = true;
      if (await signedOut()) setBack(here());
      asking = false;
    };
    const restored = async (event: PageTransitionEvent) => {
      if (event.persisted && (await signedOut())) location.replace(loginPath(here()));
    };
    window.addEventListener(DENIED_EVENT, denied);
    window.addEventListener('pageshow', restored);
    return () => {
      window.removeEventListener(DENIED_EVENT, denied);
      window.removeEventListener('pageshow', restored);
    };
  }, []);

  if (!back) return null;
  return (
    <div className="toast signed-out" role="alert">
      로그인이 끝났어요 · <a href={loginPath(back)}>다시 로그인</a>
    </div>
  );
}
