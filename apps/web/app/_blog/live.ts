'use client';

import { api } from '../_lib/client-api';
import { useLiveValue } from '../_lib/use-live';
import type { AdminAppList, MenuList, PageDetail, PageList } from './types';

// 여러 화면이 함께 쓰는 읽기.

/** 페이지가 생기거나, 새 판이 붙거나, 보이는 판 · 공개 범위가 바뀌면 온다 */
const PAGE_TOPICS = ['blog.page.changed'];

export function usePages() {
  return useLiveValue('pages', () => api<PageList>('GET', '/api/pages'), PAGE_TOPICS);
}

/** 페이지 하나와 판 목록 */
export function usePage(id: string) {
  return useLiveValue(`page:${id}`, () => api<PageDetail>('GET', `/api/pages/${id}`), PAGE_TOPICS);
}

/** 앱의 공개 여부가 바뀌거나 앱을 지우면 온다 (이름 · 순서는 고친 화면이 다시 읽는다) */
const APP_TOPICS = ['blog.app.changed'];

/** 관리자의 앱 목록 (스토어 1-5): 칸 전부와 든 것의 수, 순서대로 */
export function useApps() {
  return useLiveValue('apps', () => api<AdminAppList>('GET', '/api/apps'), APP_TOPICS);
}

/** 관리자의 메뉴 목록. app: 이 앱(주소)의 메뉴만 */
export function useMenus(app: string | null) {
  const path = app === null ? '/api/menus' : `/api/menus?app=${encodeURIComponent(app)}`;
  return useLiveValue(`menus:${app ?? ''}`, () => api<MenuList>('GET', path), []);
}
