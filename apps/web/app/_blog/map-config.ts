import { serverRaw } from '../_lib/server-api';
import type { PluginPublicSettings } from '../_platform/types';

// 지도 플러그인 (2026-11-23): 관리자가 플러그인 map에 등록한 지도 API를 앱 화면에 준다 (cairn.js의 cairn.map).
// 무엇을 쓰는지는 플러그인의 공개 설정(provider · key)이고, 웹은 회사마다 받을 스크립트의 호스트만 안다.
// 키가 있는 지도(카카오 · 네이버 · 구글)는 회사 콘솔에 등록한 도메인에서 온 요청만 받는다. 격리된 화면(출처 없는 문서)은
// 어디서 왔는지를 보내지 않아 돌지 않으므로, 그런 화면과 키가 비어 있을 때는 키가 필요 없는 OpenStreetMap으로 그린다.
// 설정은 30초 기억한다 (앱 화면마다 부르므로). 서버에 닿지 못하거나 플러그인이 꺼져 있으면 OpenStreetMap

const KEEP_MS = 30_000;

/** 회사 → 화면이 받는 스크립트 · 스타일 · 요청의 호스트 (지도 그림은 img-src의 https 어디서나) */
const HOSTS = {
  osm: ['unpkg.com'],
  kakao: ['dapi.kakao.com', 't1.daumcdn.net'],
  naver: ['oapi.map.naver.com', 'nrbe.map.naver.net', 'kr-col-ext.nelo.navercorp.com'],
  google: ['maps.googleapis.com', 'maps.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'],
} as const;

type Provider = keyof typeof HOSTS;

/** 이 화면에서 쓸 지도: 회사와 브라우저용 키 (OpenStreetMap은 키 없음) */
export type MapChoice = { provider: Provider; key: string };

const OSM: MapChoice = { provider: 'osm', key: '' };
let known: { at: number; choice: MapChoice } | null = null;

/** 이 화면에서 쓸 지도. open: 앱의 도메인으로 연 화면(격리를 푼 화면)인가 */
export async function mapFor(open: boolean): Promise<MapChoice> {
  if (!open) return OSM;
  if (known && Date.now() - known.at < KEEP_MS) return known.choice;
  known = { at: Date.now(), choice: await load() };
  return known.choice;
}

/** 지도가 받는 호스트: 고른 회사 것과, 그 회사 지도를 받지 못했을 때 그리는 OpenStreetMap 것 */
export function mapHosts(choice: MapChoice): readonly string[] {
  return [...new Set([...HOSTS[choice.provider], ...HOSTS.osm])];
}

async function load(): Promise<MapChoice> {
  const res = await serverRaw('/api/plugins/map/settings');
  if (!res?.ok) return OSM;
  const body = (await res.json().catch(() => null)) as PluginPublicSettings | null;
  const provider = body?.settings?.provider ?? 'osm';
  const key = (body?.settings?.key ?? '').trim();
  if (!(provider in HOSTS) || provider === 'osm' || key === '') return OSM;
  return { provider: provider as Provider, key };
}
