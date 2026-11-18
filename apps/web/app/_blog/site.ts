import { cache } from 'react';
import type { Owner, SpaceInfo } from '../_account/types';
import { serverGet } from '../_lib/server-api';
import type { PostList, PublicApp, PublicAppList, PublicPageList } from './types';

// 공개 화면이 함께 쓰는 사이트 정보 (스토어 1-4). 방문자로 묻는다: 관리자가 열어도 방문자가 보는 그대로
// (다른 점은 머리 오른쪽 끝의 콘솔 · 로그인 하나). 한 요청 안에서는 한 번만 읽는다 (layout과 page가 함께 부른다).

/** 공개 화면의 머리 · 아래쪽에 드는 것 */
export interface Site {
  space: SpaceInfo;
  /** 관리자로 로그인했는가 */
  owner: boolean;
  /** 공개 앱 (순서대로). 비공개 앱은 여기에 없어 주소도 없는 것과 같다 */
  apps: readonly PublicApp[];
  /** 공개 앱의 공개 글이 있는가 (없으면 그래프 링크를 숨긴다) */
  posts: boolean;
  /** 공개 페이지가 있는가 (/pages 목록) */
  pages: boolean;
}

/** 서버에 닿지 못하면 null */
export const siteNow = cache(async (): Promise<Site | null> => {
  const [space, owner, apps, posts, pages] = await Promise.all([
    serverGet<SpaceInfo>('/api/space', true),
    serverGet<Owner>('/api/auth/me'),
    serverGet<PublicAppList>('/api/apps', true),
    serverGet<PostList>('/api/posts', true),
    serverGet<PublicPageList>('/api/pages', true),
  ]);
  if (!space || !apps) return null;
  return {
    space,
    owner: owner !== null,
    apps: apps.apps,
    posts: (posts?.posts.length ?? 0) > 0,
    pages: (pages?.pages.length ?? 0) > 0,
  };
});

/** 주소의 앱 (공개 앱만). 없으면 null: 비공개 앱과 없는 앱이 같은 404가 된다 */
export function appIn(site: Site, slug: string): PublicApp | null {
  return site.apps.find((a) => a.slug === slug) ?? null;
}
