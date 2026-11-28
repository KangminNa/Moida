'use client';

import { useState } from 'react';
import type { PublicApp } from '../_blog/types';
import { AuthField } from './AuthField';
import { SharedLoginPanel } from './SharedLoginPanel';
import { StoreJoinPanel } from './StoreJoinPanel';
import type { Term } from './types';

type Mode = 'login' | 'join';

/** 탭마다의 주소: 새로 고치거나 링크로 보내도 그 탭으로 연다 */
const PATHS: Record<Mode, string> = { login: '/_/login', join: '/join' };

// 공통 앱 도메인의 로그인 · 가입 (C안, 사용자 시안 2026-11-28): 한 화면의 두 탭. 탭을 바꾸면 주소를 바꿔치기한다
// (뒤로 가기가 탭 사이를 오가지 않게, 웹 규칙 뒤로 가기). 가입하면 로그인 탭으로 넘어가 아이디를 채워 둔다.
// 칸은 앱 없는 로그인(SharedLoginPanel)과 스토어 가입(StoreJoinPanel) 그대로다
export function AuthTabs({
  initial,
  site,
  logo,
  csrf,
  returnTo,
  apps,
  terms,
  privacy,
}: {
  initial: Mode;
  site: string;
  logo: string | null;
  csrf: string | null;
  /** 로그인 뒤 돌아갈 곳 (safeReturnPath로 거른 이 도메인 안의 경로) */
  returnTo: string;
  /** 회원을 받는 앱 (없으면 가입을 받지 않는다) */
  apps: readonly PublicApp[];
  terms: Term | null;
  privacy: Term | null;
}) {
  const [mode, setMode] = useState<Mode>(initial);
  const [pulse, setPulse] = useState(0);
  const [joined, setJoined] = useState<string | null>(null);
  const back = returnTo === '/' ? '' : `?return=${encodeURIComponent(returnTo)}`;

  function show(next: Mode) {
    if (next === mode) return;
    window.history.replaceState(null, '', `${PATHS[next]}${back}`);
    setMode(next);
    setPulse((n) => n + 1);
  }

  return (
    <AuthField
      site={site}
      logo={logo}
      kicker="계정 — 하나로 모든 앱"
      title={['계정 하나로', `${site}의 앱 전부`]}
      sub="한 번 가입하면 이 사이트의 앱을 다시 가입하지 않고 써요. 약관도 여기서 한 번만 동의해요."
      notes={[
        '앱마다 처음 쓸 때 닉네임만 정해요',
        '자기 도메인 앱은 그 주소에서 같은 계정으로 한 번 더 로그인해요',
      ]}
      label="로그인과 가입"
      pulse={pulse}
    >
      <div className="au-tabs" role="tablist" aria-label="로그인 또는 가입">
        {(['login', 'join'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            className={`au-tab${mode === m ? ' is-on' : ''}`}
            aria-selected={mode === m}
            onClick={() => show(m)}
          >
            {m === 'login' ? '로그인' : '가입'}
          </button>
        ))}
      </div>
      {mode === 'login' ? (
        <SharedLoginPanel
          key={joined ?? 'login'}
          csrf={csrf}
          returnTo={returnTo}
          resetHref={`/_/reset${back}`}
          initialLogin={joined ?? ''}
          notice={joined ? `가입했어요 · ${joined}로 로그인해 주세요` : null}
        />
      ) : (
        <StoreJoinPanel
          apps={apps}
          terms={terms}
          privacy={privacy}
          onJoined={(loginId) => {
            setJoined(loginId);
            show('login');
          }}
        />
      )}
    </AuthField>
  );
}
