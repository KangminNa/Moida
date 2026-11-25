import { serverRaw } from '../_lib/server-api';
import { consoleUrlOn, isConsolePath } from './console-path';
import type { AppDomainList } from './types';

// 앱마다 도메인 (스토어 3-0, docs/스토어.md 11.4): 요청이 온 호스트가 앱 도메인이면 그 앱의 주소(slug).
// proxy.ts(모든 화면 요청)와 앱 화면(route handler)이 함께 쓴다. 목록은 서버의 공개 앱 가운데 연결을 확인한 도메인
// (GET /api/apps/domains)이고 30초 기억한다: proxy가 요청마다 부르기 때문이다.
// 서버에 닿지 못하면 앞에 읽은 목록을 쓰고, 한 번도 읽지 못했으면 앱 도메인이 없는 것으로 둔다 (기본 도메인처럼 그린다).

const KEEP_MS = 30_000;
type Known = { at: number; slugs: ReadonlyMap<string, string>; site: string | null };
let known: Known | null = null;
let loading: Promise<Known | null> | null = null;

/** 이 호스트로 여는 앱의 주소. 앱 도메인이 아니면 null */
export async function appOfHost(host: string | null): Promise<string | null> {
  if (host === null) return null;
  return (await slugs()).get(host) ?? null;
}

/** 이 앱을 여는 도메인 (공개 앱의 확인한 도메인). 없으면 null. 커뮤니티 미리 보기가 그 도메인의 글을 읽을 때 쓴다 (스토어 3-2) */
export async function hostOfApp(slug: string): Promise<string | null> {
  for (const [host, app] of await slugs()) if (app === slug) return host;
  return null;
}

/**
 * 앱 도메인에서 연 콘솔 주소(/admin, /admin/…)를 보낼 곳: 사이트 주소의 같은 경로 (2026-11-25).
 * 콘솔은 어느 도메인에서나 /admin이다. 관리자 로그인은 사이트 주소에만 있어 앱 도메인에서는 관리자인지 알 수 없으니,
 * 누가 열든 같은 곳으로 보내고 로그인 확인은 사이트의 콘솔이 한다. 사이트 주소를 정하기 전이면 null (앱 안의 없는 주소)
 */
export async function consoleUrlFor(pathname: string, search: string): Promise<string | null> {
  if (!isConsolePath(pathname)) return null;
  return consoleUrlOn((await read())?.site ?? null, pathname, search);
}

async function slugs(): Promise<ReadonlyMap<string, string>> {
  return (await read())?.slugs ?? new Map();
}

async function read(): Promise<Known | null> {
  if (known && Date.now() - known.at < KEEP_MS) return known;
  loading ??= load().finally(() => {
    loading = null;
  });
  return loading;
}

async function load(): Promise<Known | null> {
  const res = await serverRaw('/api/apps/domains');
  const list = res?.ok ? ((await res.json().catch(() => null)) as AppDomainList | null) : null;
  if (!list) return known;
  known = {
    at: Date.now(),
    slugs: new Map(list.domains.map((d) => [d.domain, d.slug])),
    site: list.site,
  };
  return known;
}
