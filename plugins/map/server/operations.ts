import {
  Actor,
  InvalidRequest,
  Operation,
  Read,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { MapLookup } from './map-lookup';
import { AddressView, GeocodeCheckView, MapUsageView, PlaceListView } from './views';

// 앱 코드의 cairn.map.search · geocode · reverse가 부르는 찾기 (docs/지도.md MP-2). 누구나 부른다 (공개 앱의 방문자):
// 서버 키는 서버에만 있고, 곳마다 분당 상한 · 하루 상한 · 10분 기억은 MapLookup이 맡는다.
// 웹의 <앱 주소>/_/map/<동작>이 방문자 주소(x-forwarded-for)와 함께 /api/p/map/<동작>으로 넘긴다

type Near = { lat: number; lng: number } | null;
type SearchInput = { q: string; near: Near; size: number };

/** 칸 하나가 틀렸다 (InvalidRequest는 칸 → 까닭) */
function invalid(field: string, why: string): InvalidRequest {
  return new InvalidRequest(new Map([[field, why]]));
}

/** 주소창의 글(쿼리)로 온 좌표 하나. 없으면 null, 틀리면 InvalidRequest */
function coordinate(raw: unknown, name: 'lat' | 'lng'): number | null {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[name] : undefined;
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value));
  const max = name === 'lat' ? 90 : 180;
  if (!Number.isFinite(n) || Math.abs(n) > max)
    throw invalid(name, `-${max}~${max} 사이의 숫자여야 해요`);
  return n;
}

function nearOf(raw: unknown): Near {
  const lat = coordinate(raw, 'lat');
  const lng = coordinate(raw, 'lng');
  if ((lat === null) !== (lng === null)) throw invalid('lat', 'lat · lng는 함께 보내요');
  return lat === null || lng === null ? null : { lat, lng };
}

/** GET /api/p/map/search?q=&lat=&lng=&size=: 장소 이름 · 주소로 찾기 (네이버는 주소 찾기로 대신) */
export class SearchPlaces extends Read<SearchInput> {
  readonly name = 'search';
  readonly allow = Operation.ANYONE;
  static readonly SIZE_MAX = 15;

  constructor(
    private readonly lookup: MapLookup,
    private readonly provider: string,
    private readonly attribution: string,
  ) {
    super();
  }

  input(raw: unknown): SearchInput {
    const q = this.fields(raw, (f) => f.text('q', 100)).trim();
    const sizeText =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>).size : undefined;
    const size = sizeText === undefined || sizeText === '' ? 10 : Number(sizeText);
    if (!Number.isInteger(size) || size < 1 || size > SearchPlaces.SIZE_MAX)
      throw invalid('size', `1~${SearchPlaces.SIZE_MAX} 사이의 정수여야 해요`);
    if (q === '') throw invalid('q', '비울 수 없어요');
    return { q, near: nearOf(raw), size };
  }

  async run(work: Work, _actor: Actor, { q, near, size }: SearchInput): Promise<PlaceListView> {
    const key = `search:${q}:${near ? `${near.lat.toFixed(3)},${near.lng.toFixed(3)}` : ''}:${size}`;
    const places = await this.lookup.answer(work.place, key, (g) => g.search(q, near, size));
    return new PlaceListView(
      places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
      this.provider,
      this.attribution,
    );
  }
}

/** GET /api/p/map/geocode?address=: 주소 → 좌표 (가장 맞는 하나, 없으면 빈 목록) */
export class GeocodeAddress extends Read<{ address: string }> {
  readonly name = 'geocode';
  readonly allow = Operation.ANYONE;

  constructor(
    private readonly lookup: MapLookup,
    private readonly provider: string,
    private readonly attribution: string,
  ) {
    super();
  }

  input(raw: unknown): { address: string } {
    const address = this.fields(raw, (f) => f.text('address', 200)).trim();
    if (address === '') throw invalid('address', '비울 수 없어요');
    return { address };
  }

  async run(work: Work, _actor: Actor, { address }: { address: string }): Promise<PlaceListView> {
    const found = await this.lookup.answer(work.place, `geocode:${address}`, (g) =>
      g.geocode(address),
    );
    const places = found && Number.isFinite(found.lat) && Number.isFinite(found.lng) ? [found] : [];
    return new PlaceListView(places, this.provider, this.attribution);
  }
}

/** GET /api/p/map/reverse?lat=&lng=: 좌표 → 주소 */
export class ReverseGeocode extends Read<{ lat: number; lng: number }> {
  readonly name = 'reverse';
  readonly allow = Operation.ANYONE;

  constructor(
    private readonly lookup: MapLookup,
    private readonly provider: string,
    private readonly attribution: string,
  ) {
    super();
  }

  input(raw: unknown): { lat: number; lng: number } {
    const near = nearOf(raw);
    if (!near) throw invalid('lat', 'lat · lng를 보내요');
    return near;
  }

  async run(
    work: Work,
    _actor: Actor,
    { lat, lng }: { lat: number; lng: number },
  ): Promise<AddressView> {
    // 좌표는 소수 다섯째 자리(약 1m)까지만 기억의 열쇠로 (같은 곳을 조금씩 바꿔 기억을 비켜 가지 않게)
    const key = `reverse:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const address = await this.lookup.answer(work.place, key, (g) => g.reverse(lat, lng));
    return new AddressView(address, this.provider, this.attribution);
  }
}

/** GET /api/p/map/usage: 찾기 사용량 (관리자, 콘솔 › 지도) */
export class MapUsage extends Read<Record<string, never>> {
  readonly name = 'usage';
  readonly allow = Operation.OWNER;

  constructor(
    private readonly provider: string,
    private readonly ready: boolean,
    private readonly limit: number,
  ) {
    super();
  }

  input(): Record<string, never> {
    return {};
  }

  async run(_work: Work, _actor: Actor): Promise<MapUsageView> {
    return new MapUsageView(this.provider, this.ready, MapLookup.spentToday(), this.limit);
  }
}

/**
 * 일꾼 도구 map_geocode (MP-4): 앱을 만들 때 주소 목록이 지도에서 찾아지는지 미리 본다.
 * 주소가 바깥 지도 회사로 나가므로 에이전트만 (Actor.AGENT_OUT). 같은 주소는 앱의 geocode와 같은 10분 기억 · 하루 상한을 쓴다
 */
export class GeocodeCheck extends Read<{ addresses: string[] }> {
  readonly name = 'geocodeCheck';
  readonly allow = Actor.AGENT_OUT;
  /** 곳마다 분당 30번(MapLookup.PER_MINUTE) 안에서 한 번에 다 묻게 */
  static readonly MAX = 20;

  constructor(
    private readonly lookup: MapLookup,
    private readonly provider: string,
    private readonly attribution: string,
  ) {
    super();
  }

  input(raw: unknown): { addresses: string[] } {
    const list =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>).addresses : undefined;
    if (!Array.isArray(list) || list.length === 0 || list.length > GeocodeCheck.MAX)
      throw invalid('addresses', `주소 1~${GeocodeCheck.MAX}개의 목록이어야 해요`);
    const addresses = list.map((a) => (typeof a === 'string' ? a.trim() : ''));
    if (addresses.some((a) => a === '' || a.length > 200))
      throw invalid('addresses', '주소는 1~200자의 글이어야 해요');
    return { addresses: [...new Set(addresses)] };
  }

  async run(
    work: Work,
    _actor: Actor,
    { addresses }: { addresses: string[] },
  ): Promise<GeocodeCheckView> {
    const results = [];
    for (const address of addresses) {
      const found = await this.lookup.answer(work.place, `geocode:${address}`, (g) =>
        g.geocode(address),
      );
      const ok = found && Number.isFinite(found.lat) && Number.isFinite(found.lng) ? found : null;
      results.push({ address, found: ok });
    }
    return new GeocodeCheckView(results, this.provider, this.attribution);
  }
}
