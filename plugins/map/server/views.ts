import type { MapPlace } from './map-search.gateway';

// 이 패키지가 내보내는 모양 (앱 코드의 cairn.map이 받는다)

/** 찾은 장소들과 찾은 회사 · 출처 표시 (회사의 결과임을 화면에 적게) */
export class PlaceListView {
  constructor(
    private readonly places: readonly MapPlace[],
    private readonly provider: string,
    private readonly attribution: string,
  ) {}

  toJSON() {
    return {
      places: this.places.map((p) => ({
        name: p.name,
        address: p.address,
        lat: p.lat,
        lng: p.lng,
        id: p.id,
      })),
      provider: this.provider,
      attribution: this.attribution,
    };
  }
}

/** 좌표 → 주소 하나 (없으면 null) */
export class AddressView {
  constructor(
    private readonly address: string | null,
    private readonly provider: string,
    private readonly attribution: string,
  ) {}

  toJSON() {
    return { address: this.address, provider: this.provider, attribution: this.attribution };
  }
}

/** 찾기 사용량 (콘솔 › 지도, MP-3): 회사 · 켜졌는지 · 오늘(UTC) 부른 수 · 하루 상한 */
export class MapUsageView {
  constructor(
    private readonly provider: string,
    private readonly ready: boolean,
    private readonly today: number,
    private readonly limit: number,
  ) {}

  toJSON() {
    return { provider: this.provider, ready: this.ready, today: this.today, limit: this.limit };
  }
}

/** 일꾼 도구 map_geocode의 답 (MCP는 snake_case): 주소마다 찾았는지 · 찾은 주소 · 좌표. 확인용이라 앱 코드에 좌표를 넣지 않는다 */
export class GeocodeCheckView {
  constructor(
    private readonly results: readonly { address: string; found: MapPlace | null }[],
    private readonly provider: string,
    private readonly attribution: string,
  ) {}

  toJSON() {
    return {
      results: this.results.map(({ address, found }) => ({
        address,
        found: found !== null,
        matched: found?.address ?? null,
        lat: found?.lat ?? null,
        lng: found?.lng ?? null,
      })),
      found: this.results.filter((r) => r.found !== null).length,
      provider: this.provider,
      attribution: this.attribution,
      note: '확인용 결과예요. 좌표를 앱 코드 · 앱 데이터에 넣지 말고 places에 주소를 넘겨요 (지도 회사 약관의 저장 기간)',
    };
  }
}
