import { type ApiReply, api } from '../_lib/client-api';
import type { AdminApp, AppCodeState } from './types';

/** 소개 페이지 앱의 주소 (공개 주소 /about) */
export const INTRO_SLUG = 'about';

// 소개 페이지 (2026-11-26): 설치를 마치거나 스토어에서 한 번 누르면 "소개" 페이지 앱이 생겨 첫 화면이 된다.
// 화면은 서버의 시작 화면 intro(starters/intro: Moida 소개, 사이트 이름 · 공개 앱은 cairn-data에서 읽는다).
// 있는 API를 차례로 부른다: 만들기(페이지 앱) → 시작 화면 intro를 버전 1로 → 공개 → 첫 화면 고정.
// 중간에 실패하면 그 답을 돌려준다 (만든 앱은 남고, 스토어에서 이어서 고치면 된다)
export async function makeIntroApp(requestId: string): Promise<ApiReply<AdminApp>> {
  const made = await api<AdminApp>('POST', '/api/apps', {
    requestId,
    kind: 'page',
    name: '소개',
    slug: INTRO_SLUG,
    description: '이 사이트와 Moida를 소개하는 첫 화면',
  });
  if (!made.ok) return made;
  const app = made.data;
  const code = await api<AppCodeState>('POST', `/api/apps/${app.id}/code/starter`, {
    version: app.version,
    template: 'intro',
  });
  if (!code.ok) return code;
  const shown = await api<AdminApp>('PATCH', `/api/apps/${app.id}`, {
    visibility: 'public',
    version: code.data.version,
  });
  if (!shown.ok) return shown;
  const home = await api<null>('PUT', '/api/apps/home', { appId: app.id });
  if (!home.ok) return home;
  return shown;
}
