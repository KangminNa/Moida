import { serverRaw } from '../_lib/server-api';
import type { AppDomainList } from './types';

// 앱마다 도메인 (스토어 3-0, docs/스토어.md 11.4): 요청이 온 호스트가 앱 도메인이면 그 앱의 주소(slug).
// proxy.ts(모든 화면 요청)와 앱 화면(route handler)이 함께 쓴다. 목록은 서버의 공개 앱 가운데 연결을 확인한 도메인
// (GET /api/apps/domains)이고 30초 기억한다: proxy가 요청마다 부르기 때문이다.
// 서버에 닿지 못하면 앞에 읽은 목록을 쓰고, 한 번도 읽지 못했으면 앱 도메인이 없는 것으로 둔다 (기본 도메인처럼 그린다).

const KEEP_MS = 30_000;
let known: { at: number; slugs: ReadonlyMap<string, string> } | null = null;
let loading: Promise<ReadonlyMap<string, string>> | null = null;

/** 이 호스트로 여는 앱의 주소. 앱 도메인이 아니면 null */
export async function appOfHost(host: string | null): Promise<string | null> {
  if (host === null) return null;
  return (await slugs()).get(host) ?? null;
}

async function slugs(): Promise<ReadonlyMap<string, string>> {
  if (known && Date.now() - known.at < KEEP_MS) return known.slugs;
  loading ??= load().finally(() => {
    loading = null;
  });
  return loading;
}

async function load(): Promise<ReadonlyMap<string, string>> {
  const res = await serverRaw('/api/apps/domains');
  const list = res?.ok ? ((await res.json().catch(() => null)) as AppDomainList | null) : null;
  if (!list) return known?.slugs ?? new Map();
  known = { at: Date.now(), slugs: new Map(list.domains.map((d) => [d.domain, d.slug])) };
  return known.slugs;
}
