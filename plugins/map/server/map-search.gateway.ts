import { BaseGateway, ExternalFailure } from '../../../apps/server/src/plugin-api';

/** 찾은 장소 하나 (회사마다 다른 응답을 이 모양으로 맞춘다) */
export type MapPlace = { name: string; address: string; lat: number; lng: number; id: string };

/** 찾기에 쓰는 회사와 키 (설정의 서버 키, 네이버는 Client ID와 Secret 둘) */
export type MapSearchKeys = { kakao: string; naverId: string; naverSecret: string; google: string };

/** 회사의 서버 API 주소. 테스트는 테스트용 웹 서버 주소로 바꿔 넣는다 */
export type MapSearchBases = { kakao: string; naver: string; google: string; googlePlaces: string };

/**
 * 지도 회사의 장소 · 주소 찾기 (docs/지도.md MP-2). 서버 키는 머리글 · 주소에 실려 회사로만 간다:
 * 오류 글에 주소 · 머리글을 넣지 않는다 (구글은 키가 주소에 있다).
 *   카카오 로컬: Authorization: KakaoAK <REST 키>. 키워드 찾기 · 주소 찾기 · 좌표 → 주소
 *   네이버 Maps: x-ncp-apigw-api-key-id · x-ncp-apigw-api-key. 주소 찾기 · 좌표 → 주소 (장소 이름 찾기는 없다: 주소 찾기로 대신)
 *   구글: Places(New) Text Search(X-Goog-Api-Key · X-Goog-FieldMask) · Geocoding(key=)
 */
export class MapSearchGateway extends BaseGateway {
  static readonly BASES: MapSearchBases = {
    kakao: 'https://dapi.kakao.com',
    naver: 'https://maps.apigw.ntruss.com',
    google: 'https://maps.googleapis.com',
    googlePlaces: 'https://places.googleapis.com',
  };
  protected readonly name = '지도 찾기';
  protected override readonly timeoutMs = 5_000;

  constructor(
    private readonly provider: 'kakao' | 'naver' | 'google',
    private readonly keys: MapSearchKeys,
    private readonly bases: MapSearchBases = MapSearchGateway.BASES,
  ) {
    super();
  }

  /** 장소 이름 · 주소로 찾기. near가 있으면 그 근처를 먼저 */
  async search(
    query: string,
    near: { lat: number; lng: number } | null,
    size: number,
  ): Promise<MapPlace[]> {
    if (this.provider === 'kakao') {
      const params = new URLSearchParams({ query, size: String(size) });
      if (near) {
        params.set('x', String(near.lng));
        params.set('y', String(near.lat));
      }
      const body = await this.kakao(`/v2/local/search/keyword.json?${params}`);
      return MapSearchGateway.list(body.documents).map((d) => ({
        name: MapSearchGateway.text(d.place_name),
        address:
          MapSearchGateway.text(d.road_address_name) || MapSearchGateway.text(d.address_name),
        lat: Number(d.y),
        lng: Number(d.x),
        id: MapSearchGateway.text(d.id),
      }));
    }
    if (this.provider === 'google') {
      const body = await this.googlePlaces(query, near, size);
      return MapSearchGateway.list(body.places).map((p) => {
        const location = (p.location ?? {}) as Record<string, unknown>;
        const display = (p.displayName ?? {}) as Record<string, unknown>;
        return {
          name: MapSearchGateway.text(display.text),
          address: MapSearchGateway.text(p.formattedAddress),
          lat: Number(location.latitude),
          lng: Number(location.longitude),
          id: MapSearchGateway.text(p.id),
        };
      });
    }
    return (await this.naverGeocode(query)).slice(0, size);
  }

  /** 주소 → 좌표 (가장 맞는 하나) */
  async geocode(address: string): Promise<MapPlace | null> {
    if (this.provider === 'kakao') {
      const body = await this.kakao(
        `/v2/local/search/address.json?${new URLSearchParams({ query: address, size: '1' })}`,
      );
      const [d] = MapSearchGateway.list(body.documents);
      if (!d) return null;
      const name = MapSearchGateway.text(d.address_name);
      return { name, address: name, lat: Number(d.y), lng: Number(d.x), id: '' };
    }
    if (this.provider === 'google') {
      const body = await this.google('/maps/api/geocode/json', { address });
      const [r] = MapSearchGateway.list(body.results);
      return r ? MapSearchGateway.googleResult(r) : null;
    }
    return (await this.naverGeocode(address))[0] ?? null;
  }

  /** 좌표 → 주소 */
  async reverse(lat: number, lng: number): Promise<string | null> {
    if (this.provider === 'kakao') {
      const params = new URLSearchParams({ x: String(lng), y: String(lat) });
      const body = await this.kakao(`/v2/local/geo/coord2address.json?${params}`);
      const [d] = MapSearchGateway.list(body.documents);
      if (!d) return null;
      const road = (d.road_address ?? {}) as Record<string, unknown>;
      const lot = (d.address ?? {}) as Record<string, unknown>;
      return (
        MapSearchGateway.text(road.address_name) || MapSearchGateway.text(lot.address_name) || null
      );
    }
    if (this.provider === 'google') {
      const body = await this.google('/maps/api/geocode/json', { latlng: `${lat},${lng}` });
      const [r] = MapSearchGateway.list(body.results);
      return r ? MapSearchGateway.text(r.formatted_address) || null : null;
    }
    const params = new URLSearchParams({
      coords: `${lng},${lat}`,
      output: 'json',
      orders: 'roadaddr,addr',
    });
    const body = await this.naver(`/map-reversegeocode/v2/gc?${params}`);
    const [r] = MapSearchGateway.list(body.results);
    return r ? MapSearchGateway.naverAddress(r) : null;
  }

  private kakao(path: string): Promise<Record<string, unknown>> {
    return this.json(`${this.bases.kakao}${path}`, {
      headers: { authorization: `KakaoAK ${this.keys.kakao}` },
    });
  }

  private naver(path: string): Promise<Record<string, unknown>> {
    return this.json(`${this.bases.naver}${path}`, {
      headers: {
        'x-ncp-apigw-api-key-id': this.keys.naverId,
        'x-ncp-apigw-api-key': this.keys.naverSecret,
      },
    });
  }

  private async naverGeocode(query: string): Promise<MapPlace[]> {
    const body = await this.naver(`/map-geocode/v2/geocode?${new URLSearchParams({ query })}`);
    return MapSearchGateway.list(body.addresses).map((a) => {
      const address = MapSearchGateway.text(a.roadAddress) || MapSearchGateway.text(a.jibunAddress);
      return { name: address, address, lat: Number(a.y), lng: Number(a.x), id: '' };
    });
  }

  private async google(
    path: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ ...params, key: this.keys.google, language: 'ko' });
    const body = await this.json(`${this.bases.google}${path}?${query}`, {});
    const status = MapSearchGateway.text(body.status);
    if (status !== 'OK' && status !== 'ZERO_RESULTS')
      throw new ExternalFailure(`구글 지오코딩이 거절했어요: ${status.slice(0, 40)}`);
    return body;
  }

  private googlePlaces(
    textQuery: string,
    near: { lat: number; lng: number } | null,
    size: number,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { textQuery, maxResultCount: size, languageCode: 'ko' };
    if (near)
      body.locationBias = {
        circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 5000 },
      };
    return this.json(`${this.bases.googlePlaces}/v1/places:searchText`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.keys.google,
        'x-goog-fieldmask': 'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify(body),
    });
  }

  /** 응답 JSON. 2xx가 아니면 상태 번호만 알린다 (주소 · 머리글에 키가 있다) */
  private async json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const answer = await this.call(async (signal) => {
      const res = await fetch(url, { ...init, signal, redirect: 'error' });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return { status: res.status, json };
    });
    if (answer.status < 200 || answer.status >= 300 || answer.json === null)
      throw new ExternalFailure(`지도 회사가 거절했어요: ${answer.status}`);
    return answer.json;
  }

  private static googleResult(r: Record<string, unknown>): MapPlace {
    const geometry = (r.geometry ?? {}) as Record<string, unknown>;
    const location = (geometry.location ?? {}) as Record<string, unknown>;
    const address = MapSearchGateway.text(r.formatted_address);
    return {
      name: address,
      address,
      lat: Number(location.lat),
      lng: Number(location.lng),
      id: MapSearchGateway.text(r.place_id),
    };
  }

  /** 네이버 역지오코딩 결과 하나 → "시 구 동 번지" (region.area1~4 + land) */
  private static naverAddress(r: Record<string, unknown>): string | null {
    const region = (r.region ?? {}) as Record<string, Record<string, unknown>>;
    const land = (r.land ?? {}) as Record<string, unknown>;
    const parts = ['area1', 'area2', 'area3', 'area4'].map((k) =>
      MapSearchGateway.text(region[k]?.name),
    );
    const number = [land.number1, land.number2]
      .map(MapSearchGateway.text)
      .filter(Boolean)
      .join('-');
    parts.push(MapSearchGateway.text(land.name), number);
    const text = parts.filter(Boolean).join(' ').trim();
    return text || null;
  }

  private static list(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value)
      ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
      : [];
  }

  private static text(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
}
