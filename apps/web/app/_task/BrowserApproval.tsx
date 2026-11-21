'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { useLiveValue } from '../_lib/use-live';
import { Screen } from '../_plugins/installed/browser-tabs/Screen';
import { callFor } from '../_plugins/packages';
import { LoginFields, useLoginCard } from './LoginFields';
import { LOGGED_IN_NOTE } from './labels';
import type { Approval, BrowserClick, BrowserShot, BrowserShots } from './types';

// browser-tabs 패키지의 승인 두 가지 (2차 3단계 서버 브라우저 목표). 무엇을 승인하는지는 패키지가 기록한 것을 읽는다 (에이전트의 메모가 아니라).
//   승인된 클릭(browser.site.publish, 대상 browser_click): 페이지 · 버튼 · 멈춘 화면(버튼 자리에 테두리). 승인하면 러너가 같은 버튼인지 보고 누른다
//   로그인 필요(browser.site.login, 대상 browser_site): 로그인 · 가입 · 본인 인증 · 캡차처럼 사람이 해야 하는 화면.
//     카드 안에서 서버 브라우저의 그 탭을 열어 바로 하고(2026-11-17, 패키지의 Screen을 pin으로), "로그인했어요"(수정 요청)로 같은 작업을 잇는다

const BROWSER_PAGE = '/admin/p/browser-tabs';
/** 카드 안 화면이 패키지 API를 부르는 길 (콘솔의 브라우저 화면과 같다, 관리자만) */
const browserCall = callFor('browser-tabs');
/** 러너가 승인 메모 앞에 적는 까닭: "확인 필요(캡차): …" (apps/runner browse-stage.ts의 needLogin과 같게) */
const REASON = /^확인 필요\((.+?)\)/;
const CLICK_STATUS: Record<string, string> = {
  requested: '누르기 요청됨',
  held: '승인 대기',
  approved: '누를 차례',
  clicking: '누르는 중',
  clicked: '눌렀음',
  changed: '바뀌어 누르지 않음',
  unknown: '눌렸는지 모름',
  dropped: '닫힘',
  manual: '직접 처리',
};

/** 화면 그림 위에 버튼 자리를 테두리로 (자리는 보이는 화면의 CSS 픽셀, 그림은 그 화면 그대로) */
function MarkedShot({
  image,
  box,
  label,
}: {
  image: string;
  box: { x: number; y: number; width: number; height: number } | null;
  label: string;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div style={{ position: 'relative' }}>
      {/* biome-ignore lint/performance/noImgElement: 관리자만 보는 화면 그림(base64)이라 Next의 이미지 최적화를 거치지 않는다 */}
      <img
        src={`data:image/jpeg;base64,${image}`}
        alt={label}
        style={{ display: 'block', width: '100%', height: 'auto' }}
        onLoad={(e) =>
          setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
        }
      />
      {box && size && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: pct(box.x, size.width),
            top: pct(box.y, size.height),
            width: pct(box.width, size.width),
            height: pct(box.height, size.height),
            outline: '3px solid currentColor',
            outlineOffset: 2,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

/**
 * browser.site.publish의 누르기 계획 (대상 browser_click_plan, F2 2026-11-21): 같은 사이트에서 마지막 버튼을 여러 번 누르는 일.
 * 승인하면 같은 일이 이어서 돌고, AI가 요청한 버튼을 러너가 다시 찾아 계획한 횟수까지만 누른다. 누른 것은 브라우저 › 클릭에 하나씩 남는다
 */
export function PlanTarget({ approval }: { approval: Approval }) {
  return (
    <section className="preview" aria-label="누르기 계획">
      <b>{approval.note ?? '누르기 계획'}</b>
      <p className="note">
        승인하면 이 일이 이어서 돌고, 버튼마다 러너가 같은 사이트 안에서 다시 찾아 눌러요. 계획한
        횟수를 넘거나 다른 사이트의 버튼은 누르지 않아요. 누른 것은{' '}
        <Link href={BROWSER_PAGE}>브라우저</Link>의 클릭에 하나씩 남아요
      </p>
    </section>
  );
}

/** browser.site.publish: 러너가 붙잡은 페이지 · 버튼 · 멈춘 화면 */
export function ClickTarget({ approval }: { approval: Approval }) {
  const { id, version } = approval.target;
  const { data: click, error } = useLiveValue(
    `browser-click:${id}`,
    () => api<BrowserClick>('GET', `/api/p/browser-tabs/clicks/${id}`),
    [],
  );
  if (error) return <p className="error">{error}</p>;
  if (!click) return <p className="label-mono">클릭 불러오는 중…</p>;
  return (
    <section className="preview" aria-label="누를 버튼">
      <b>{click.pageTitle || click.pageUrl}</b>
      {click.version !== version && click.status === 'held' && (
        <p className="warn">승인 뒤 다시 붙잡은 클릭이에요. 승인해도 누르지 않아요</p>
      )}
      <dl className="kv">
        <dt>사이트</dt>
        <dd>{click.siteName ?? '지운 사이트'}</dd>
        <dt>페이지</dt>
        <dd className="label-mono">{click.pageUrl}</dd>
        <dt>버튼</dt>
        <dd>
          {click.role} “{click.name}”{click.nth > 0 ? ` (${click.nth + 1}번째)` : ''}
        </dd>
        <dt>상태</dt>
        <dd>
          {CLICK_STATUS[click.status] ?? click.status}
          {click.reason ? ` · ${click.reason}` : ''}
        </dd>
      </dl>
      {click.beforeImage && (
        <MarkedShot image={click.beforeImage} box={click.box} label="멈춘 화면" />
      )}
      {click.afterImage && (
        <>
          <b>{click.afterKind === 'changed' ? '바뀐 화면' : '누른 뒤 화면'}</b>
          <MarkedShot image={click.afterImage} box={null} label="누른 뒤 화면" />
        </>
      )}
      <p className="note">
        승인하면 러너가 같은 페이지 · 같은 버튼인지 다시 확인하고 눌러요. 다르면 누르지 않고{' '}
        <Link href={BROWSER_PAGE}>브라우저 화면</Link>에서 직접 하도록 알려요 · 단계 화면{' '}
        {click.shots.filter((s) => s.kind === 'step').length}장
      </p>
    </section>
  );
}

/** browser.site.login: 러너가 만난 로그인 화면. 로그인 칸이 있으면 칸에 넣어 로그인(2026-11-19), 화면에서 직접도 된다 */
export function LoginTarget({
  approval,
  reload,
}: {
  approval: Approval;
  reload?: () => Promise<void>;
}) {
  const taskId = approval.taskId;
  const shots = useLiveValue<BrowserShots | null>(
    `browser-shots:${taskId}`,
    () =>
      taskId
        ? api<BrowserShots>('GET', `/api/p/browser-tabs/shots?taskId=${taskId}`)
        : Promise.resolve({ ok: true, data: null } as const),
    [],
  );
  const login = shots.data?.shots.filter((s) => s.kind === 'login').at(-1) ?? null;
  const shot = useLiveValue<BrowserShot | null>(
    `browser-shot:${login?.id ?? 'none'}`,
    () =>
      login
        ? api<BrowserShot>('GET', `/api/p/browser-tabs/shots/${login.id}`)
        : Promise.resolve({ ok: true, data: null } as const),
    [],
  );
  // 기다리는 동안의 메모는 러너가 남긴 요청 메모다 (정한 뒤에는 결정의 말로 바뀐다)
  const pending = approval.status === 'pending';
  const reason = pending ? (REASON.exec(approval.note ?? '')?.[1] ?? null) : null;
  const card = useLoginCard(pending ? approval.target.id : null);
  const fields = card.data?.fields ? card.data : null;
  return (
    <section className="preview" aria-label="로그인 필요">
      <b>{reason ? `확인이 필요해요 · ${reason}` : '로그인이 풀렸어요'}</b>
      {login && <p className="label-mono">{login.url}</p>}
      {shot.data && <MarkedShot image={shot.data.image} box={null} label="멈춘 화면" />}
      {pending && fields && (
        <LoginFields approval={approval} card={fields} reloadCard={card.reload} reload={reload} />
      )}
      {pending && login ? (
        fields ? (
          <details>
            <summary>화면에서 직접 하기</summary>
            <Screen call={browserCall} pin={{ url: login.url }} />
          </details>
        ) : (
          <>
            <p className="note">
              아래 화면을 열어 그 사이트에서 직접 로그인 · 인증(2단계 인증 포함)한 뒤 “
              {LOGGED_IN_NOTE}
              ”를 누르면 같은 작업이 처음부터 이어서 해요. 비밀번호는 어디에도 남지 않아요
            </p>
            <Screen call={browserCall} pin={{ url: login.url }} />
          </>
        )
      ) : (
        <p className="note">
          <Link href={BROWSER_PAGE}>브라우저 화면</Link>에서 그 사이트에 로그인(2단계 인증 포함)한
          뒤 “{LOGGED_IN_NOTE}”를 누르면 같은 작업이 처음부터 이어서 해요. 비밀번호는 어디에도 남지
          않아요
        </p>
      )}
    </section>
  );
}

/** 로그인 승인의 결정: "로그인했어요"(같은 작업을 다시 대기열로) · 반려(작업 취소) */
export function LoginDecide({
  approval,
  reload,
}: {
  approval: Approval;
  reload: () => Promise<void>;
}) {
  const action = useAction();
  const decide = (decision: 'revise' | 'reject') =>
    void action.run(
      decision,
      () =>
        api<Approval>('POST', `/api/approvals/${approval.id}/decide`, {
          version: approval.version,
          decision,
          ...(decision === 'revise' ? { note: LOGGED_IN_NOTE } : {}),
        }),
      {
        done: decision === 'revise' ? '이어서 해요' : '반려됨',
        reload,
        conflict: '이미 바뀐 승인이에요. 최신 내용을 다시 읽었어요',
      },
    );
  return (
    <div className="decide">
      {action.problem && <p className="error">{action.problem}</p>}
      <div className="row">
        <button
          type="button"
          className="cta small"
          disabled={action.busy !== null}
          onClick={() => decide('revise')}
        >
          {LOGGED_IN_NOTE}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={action.busy !== null}
          onClick={() => decide('reject')}
        >
          반려
        </button>
      </div>
    </div>
  );
}
