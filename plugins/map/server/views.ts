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
