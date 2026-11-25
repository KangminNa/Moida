import MAPS from '../../../../plugins/map/providers.json';
import { serverRaw } from '../_lib/server-api';
import type { PluginPublicSettings } from '../_platform/types';

// 지도 플러그인 (2026-11-23, 2차 MP-1 2026-11-25 docs/지도.md): 관리자가 플러그인 map에 등록한 지도 API를 앱 화면에 준다 (cairn.js의 cairn.map).
// 회사마다 키 칸 · 스크립트 주소 · 호스트는 plugins/map/providers.json 한 곳에 있고, 여기는 그 파일과 공개 설정을 합친다.
// 키가 있는 지도(카카오 · 네이버 · 구글)는 회사 콘솔에 등록한 도메인에서 온 요청만 받는다. 격리된 화면(출처 없는 문서)과 키가 빈 경우는
// 키가 필요 없는 OpenStreetMap으로 그린다. 설정은 30초 기억한다 (앱 화면마다 부르므로). 서버에 닿지 못하거나 플러그인이 꺼져 있으면 OpenStreetMap

const KEEP_MS = 30_000;

type Provider = keyof typeof MAPS.providers;
type Tiles = keyof typeof MAPS.tiles;

/** 키 없는 지도의 타일: 주소 · 하위 도메인 · 확대 한도 · 출처 표시 (providers.json의 tiles) */
export type MapTiles = (typeof MAPS.tiles)[Tiles];

/**
 * 이 화면에서 쓸 지도. script는 키를 넣은 회사 스크립트 주소 (OpenStreetMap은 null),
 * tiles는 OpenStreetMap으로 그릴 때(고른 회사를 받지 못했을 때도)의 타일
 */
export type MapChoice = { provider: Provider | 'osm'; script: string | null; tiles: MapTiles };

const DEFAULT_TILES: Tiles = 'osm';
let known: { at: number; settings: Record<string, string> } | null = null;

/** 이 화면에서 쓸 지도. open: 앱의 도메인으로 연 화면(격리를 푼 화면)인가 */
export async function mapFor(open: boolean): Promise<MapChoice> {
  return choose(await settings(), open);
}

/** 공개 설정 → 지도 (서버 없이 테스트한다) */
export function choose(values: Readonly<Record<string, string>>, open: boolean): MapChoice {
  const tilesName = values.osmTiles ?? DEFAULT_TILES;
  const tiles = MAPS.tiles[tilesName in MAPS.tiles ? (tilesName as Tiles) : DEFAULT_TILES];
  const osm: MapChoice = { provider: 'osm', script: null, tiles };
  const provider = values.provider ?? 'osm';
  if (!open || !(provider in MAPS.providers)) return osm;
  const spec = MAPS.providers[provider as Provider];
  const key = (values[spec.keySetting] ?? '').trim();
  if (key === '') return osm;
  return {
    provider: provider as Provider,
    script: spec.script.replace('{key}', encodeURIComponent(key)),
    tiles,
  };
}

/** 지도가 받는 호스트: 고른 회사 것과, 그 회사 지도를 받지 못했을 때 그리는 OpenStreetMap(Leaflet) 것 */
export function mapHosts(choice: MapChoice): readonly string[] {
  const own = choice.provider === 'osm' ? [] : MAPS.providers[choice.provider].hosts;
  return [...new Set([...own, ...MAPS.leaflet.hosts])];
}

async function settings(): Promise<Record<string, string>> {
  if (known && Date.now() - known.at < KEEP_MS) return known.settings;
  known = { at: Date.now(), settings: await load() };
  return known.settings;
}

async function load(): Promise<Record<string, string>> {
  const res = await serverRaw('/api/plugins/map/settings');
  if (!res?.ok) return {};
  const body = (await res.json().catch(() => null)) as PluginPublicSettings | null;
  const found: Record<string, string> = {};
  for (const [name, value] of Object.entries(body?.settings ?? {}))
    if (typeof value === 'string') found[name] = value;
  return found;
}
