import { hostOfApp } from '../_blog/app-domains';
import { appHeaderOf, appsOrigin, opensApp } from '../_blog/apps-domain';
import type { AppScreenData } from '../_blog/types';
import { serverFetch } from '../_lib/server-api';
import { type CommunityPlace, communityOf, topicOf, topicsOf } from './screen';
import type { MemberMe, TopicDetail, TopicList } from './types';

// 커뮤니티 앱 화면의 데이터 읽기 (스토어 3-2, 서버에서 그릴 때). 서버의 블로그 화면 API는 틀만 주고,
// 글 · 댓글 · 회원은 이미 있는 회원 API(GET topics · topics/:id · me)로 읽는다. 회원 API는 앱 도메인에서만 열려
// 그 도메인으로 온 요청처럼(X-Forwarded-Host) 묻는다.
//   앱 도메인으로 온 화면: 방문자의 브라우저 쿠키(그 도메인의 회원 쿠키)를 넘겨 내 글 · 댓글(mine)과 회원 링크까지
//   그 밖 (관리자의 미리 보기): 쿠키 없이 방문자로 읽기만, 회원 링크 없음 (공개 앱이면 그 도메인의 글, 비공개면 빈 목록)

/** 채운 데이터. missing: 글 화면인데 글이 없거나 보이지 않음 (그 앱의 404.html을 404로) */
export type CommunityScreen = { extra: Record<string, unknown>; missing: boolean };

export async function communityScreen(
  data: AppScreenData,
  app: string,
  requestHost: string | null,
  parts: readonly string[],
  cursor: string | null,
): Promise<CommunityScreen> {
  const own = await opensApp(requestHost, app);
  // 미리 보기(기본 도메인)는 그 앱의 도메인, 없으면 공통 앱 도메인으로 읽는다 (2026-11-27)
  const shared = appsOrigin();
  const host = own
    ? requestHost
    : ((await hostOfApp(app)) ?? (shared ? new URL(shared).hostname : null));
  const header = appHeaderOf(host, app);
  const place: CommunityPlace = { base: data.base, open: own, here: here(data.base, parts) };
  const read = <T>(path: string) =>
    host === null
      ? Promise.resolve(null)
      : serverFetch<T>(`/api/community/${path}`, !own, host, header).then((r) =>
          r.status === 200 ? r.data : null,
        );
  const me = own ? await read<MemberMe>('me') : null;
  const extra: Record<string, unknown> = { community: communityOf(place, me) };
  if (data.screen === 'home') {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    Object.assign(extra, topicsOf(await read<TopicList>(`topics${query}`), place));
  }
  if (data.screen !== 'topic') return { extra, missing: false };
  const topic = await read<TopicDetail>(`topics/${encodeURIComponent(parts[1] ?? '')}`);
  if (topic === null) return { extra, missing: true };
  extra.topic = topicOf(topic, place);
  extra.title = `${topic.title} · ${data.app.name}`;
  return { extra, missing: false };
}

/** 지금 화면의 앱 안 주소 (로그인 뒤 돌아올 곳) */
function here(base: string, parts: readonly string[]): string {
  return `${base.replace(/\/$/, '')}/${parts.join('/')}`;
}
