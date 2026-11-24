import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { appOfHost } from '../_blog/app-domains';
import { slugFrom } from '../_blog/format';
import { hostOf } from '../_blog/request-host';
import type { PublicApp } from '../_blog/types';
import { serverGet } from '../_lib/server-api';
import { blockNotice, waitNotice } from './member-state';
import type { MemberMe, MemberSelf, Term, TopicDetail } from './types';

// 고정 화면(/_/…, 스토어 3-2)의 서버 쪽 준비. 회원 API는 앱 도메인에서만 열리므로 화면도 그 도메인으로 온 요청에서만 연다:
// 기본 도메인의 /<앱>/_/…와 회원을 받지 않는 앱의 도메인은 없는 주소(404). 가입 · 로그인 · 내 정보는 회원을 받는 모든 앱
// (커뮤니티 앱과 선언서에 members를 적은 앱, 스토어 12.3), 글쓰기 · 댓글 · 신고는 커뮤니티 앱만. 앱 도메인의 브라우저 쿠키는 그 도메인의
// 회원 쿠키뿐이라 그대로 넘겨 이 브라우저의 회원과 쓰기 확인 값(csrf)을 읽는다

/** 고정 화면 하나의 바탕: 앱 · 이 브라우저의 회원 · 쓰기 확인 값 */
export type MemberPlace = {
  app: PublicApp;
  host: string;
  member: MemberSelf | null;
  csrf: string | null;
};

export async function memberPlace(rawApp: string): Promise<MemberPlace> {
  const slug = slugFrom(rawApp);
  const host = hostOf(await headers());
  if (host === null || (await appOfHost(host)) !== slug) notFound();
  const [me, app] = await Promise.all([
    serverGet<MemberMe>('/api/community/me', false, host),
    serverGet<PublicApp>(`/api/apps/by-slug/${encodeURIComponent(slug)}`, true),
  ]);
  if (!me || !app || !app.members) notFound();
  return { app, host, member: me.member, csrf: me.csrf };
}

/** 커뮤니티 앱만 여는 화면 (글쓰기 · 댓글 · 신고): 회원만 받는 다른 앱에서는 없는 주소 (스토어 12.3) */
export async function communityPlace(rawApp: string): Promise<MemberPlace> {
  const place = await memberPlace(rawApp);
  if (place.app.kind !== 'community') notFound();
  return place;
}

/** 회원만 여는 화면: 로그인하지 않았으면 로그인 화면으로 (돌아올 곳은 이 화면) */
export function signedIn(place: MemberPlace, back: string): MemberSelf {
  if (!place.member) redirect(`/_/login?return=${encodeURIComponent(back)}`);
  return place.member;
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

/** 공개된 약관 하나 (3-4): 가입 화면의 동의 칸 · /_/terms · /_/privacy. 아직 없으면 null */
export function termOf(place: MemberPlace, kind: Term['kind']): Promise<Term | null> {
  return serverGet<Term>(`/api/community/terms/${kind}`, false, place.host);
}
