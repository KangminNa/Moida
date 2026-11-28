import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { appHeaderOf, opensApp } from '../_blog/apps-domain';
import { slugFrom } from '../_blog/format';
import { hostOf } from '../_blog/request-host';
import type { PublicApp } from '../_blog/types';
import { serverGet } from '../_lib/server-api';
import { blockNotice, waitNotice } from './member-state';
import type { AccountSelf, MemberMe, MemberSelf, Term, TopicDetail } from './types';

// 고정 화면(/_/…, 스토어 3-2)의 서버 쪽 준비. 회원 API는 앱 도메인에서만 열리므로 화면도 그 도메인으로 온 요청에서만 연다:
// 기본 도메인의 /<앱>/_/…와 회원을 받지 않는 앱의 도메인은 없는 주소(404). 가입 · 로그인 · 내 정보는 회원을 받는 모든 앱
// (커뮤니티 앱과 선언서에 members를 적은 앱, 스토어 12.3), 글쓰기 · 댓글 · 신고는 커뮤니티 앱만. 앱 도메인의 브라우저 쿠키는 그 도메인의
// 회원 쿠키뿐이라 그대로 넘겨 이 브라우저의 회원과 쓰기 확인 값(csrf)을 읽는다.
// 공통 앱 도메인(MOIDA_APPS_URL, 2026-11-27)에서는 고정 화면이 /<앱>/_/… 아래에 있고(base = /<앱>), 서버에는 x-moida-app으로 앱을 알린다

/** 고정 화면 하나의 바탕: 앱 · 이 브라우저에 로그인한 계정 · 그 계정의 이 앱 회원(참여 전이면 null) · 쓰기 확인 값 */
export type MemberPlace = {
  app: PublicApp;
  host: string;
  /** 이 앱 화면의 뿌리: 자기 도메인은 '', 공통 앱 도메인은 /<앱>. 고정 화면의 주소는 `${base}/_/…` */
  base: string;
  /** 서버에 알릴 앱 (공통 앱 도메인에서만, x-moida-app) */
  appHeader: string | null;
  account: AccountSelf | null;
  member: MemberSelf | null;
  csrf: string | null;
};

export async function memberPlace(rawApp: string): Promise<MemberPlace> {
  const slug = slugFrom(rawApp);
  const host = hostOf(await headers());
  if (host === null || !(await opensApp(host, slug))) notFound();
  const appHeader = appHeaderOf(host, slug);
  const [me, app] = await Promise.all([
    serverGet<MemberMe>('/api/community/me', false, host, appHeader),
    serverGet<PublicApp>(`/api/apps/by-slug/${encodeURIComponent(slug)}`, true),
  ]);
  if (!me || !app || !app.members) notFound();
  const base = appHeader ? `/${slug}` : '';
  return { app, host, base, appHeader, account: me.account, member: me.member, csrf: me.csrf };
}

/** 커뮤니티 앱만 여는 화면 (글쓰기 · 댓글 · 신고): 회원만 받는 다른 앱에서는 없는 주소 (스토어 12.3) */
export async function communityPlace(rawApp: string): Promise<MemberPlace> {
  const place = await memberPlace(rawApp);
  if (place.app.kind !== 'community') notFound();
  return place;
}

/** 고정 화면으로 보내기: screen은 enter · login 같은 이름, back은 끝난 뒤 돌아올 곳 (base가 붙은 경로) */
export function toScreen(place: MemberPlace, screen: string, back: string): never {
  redirect(`${place.base}/_/${screen}?return=${encodeURIComponent(back)}`);
}

/**
 * 회원만 여는 화면: 로그인하지 않았으면 로그인 화면으로, 로그인했지만 이 앱에 참여하지 않았으면 참여 화면으로
 * (돌아올 곳은 이 화면. here는 /_/… 경로이고 base는 여기서 붙인다)
 */
export function signedIn(place: MemberPlace, here: string): MemberSelf {
  if (!place.member) toScreen(place, place.account ? 'enter' : 'login', place.base + here);
  return place.member;
}

/** 계정이 필요한 화면 (내 정보): 회원이면 계정도 있다. 로그인이 끝났으면 로그인 화면으로 */
export function signedAccount(place: MemberPlace, here: string): AccountSelf {
  if (!place.account) toScreen(place, 'login', place.base + here);
  return place.account;
}

/** 쓰기 안내: 차단이 먼저, 그다음 가입 대기 (글 · 댓글). 쓸 수 있으면 null */
export function writeNotice(member: MemberSelf, waits: boolean): string | null {
  const now = Date.now();
  return blockNotice(member, now) ?? (waits ? waitNotice(member, now) : null);
}

/** 보이는 글 하나 (회원 쿠키로 읽어 내 글 · 내 댓글이면 version까지). 없거나 보이지 않으면 404 */
export async function shownTopic(place: MemberPlace, id: string): Promise<TopicDetail> {
  const topic = await serverGet<TopicDetail>(
    `/api/community/topics/${encodeURIComponent(id)}`,
    false,
    place.host,
    place.appHeader,
  );
  if (!topic) notFound();
  return topic;
}

/** 탭 제목: "<앱 이름> · <화면>" */
export async function memberTitle(rawApp: string, label: string): Promise<{ title: string }> {
  const app = await serverGet<PublicApp>(
    `/api/apps/by-slug/${encodeURIComponent(slugFrom(rawApp))}`,
    true,
  );
  return { title: app ? `${label} · ${app.name}` : label };
}

/**
 * 공개된 약관 하나 (3-4): 가입 · 참여 화면의 동의 칸 · /_/terms · /_/privacy. 아직 없으면 null.
 * store면 공간(스토어)의 공통 약관 (2026-11-26, 가입할 때 한 번 동의), 아니면 이 앱의 약관 (공개했을 때만 참여할 때 동의)
 */
export function termOf(
  place: MemberPlace,
  kind: Term['kind'],
  store = false,
): Promise<Term | null> {
  return serverGet<Term>(
    `/api/community/terms/${store ? 'store/' : ''}${kind}`,
    false,
    place.host,
    place.appHeader,
  );
}

/** 가입 · 참여 화면이 읽는 약관 넷: 공통 약관 둘과 이 앱의 약관 둘 */
export async function termsOf(place: MemberPlace): Promise<{
  terms: Term | null;
  privacy: Term | null;
  appTerms: Term | null;
  appPrivacy: Term | null;
}> {
  const [terms, privacy, appTerms, appPrivacy] = await Promise.all([
    termOf(place, 'terms', true),
    termOf(place, 'privacy', true),
    termOf(place, 'terms'),
    termOf(place, 'privacy'),
  ]);
  return { terms, privacy, appTerms, appPrivacy };
}
