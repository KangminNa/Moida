import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import MAPS from '../providers.json';
import { MapLookup } from './map-lookup';
import { MapSearchGateway } from './map-search.gateway';
import { GeocodeAddress, MapUsage, ReverseGeocode, SearchPlaces } from './operations';

// 지도 플러그인의 서버 (docs/지도.md MP-2): 장소 · 주소 찾기를 서버 키로 대신 부른다.
// 그리기(브라우저용 키 · 스크립트 · 타일)는 웹(_blog/map-config.ts)이 공개 설정으로 하고, 서버 키는 여기서만 쓴다.
// 구글 찾기는 구글 지도와 함께일 때만 (지오코딩 결과는 구글 지도에 보여야 한다, 구글 약관)
export default class MapPlugin extends BasePlugin {
  register(cairn: PluginContext): void {
    const settings = cairn.settings();
    const chosen = settings.get('searchProvider') ?? 'none';
    const provider =
      chosen === 'kakao' || chosen === 'naver' || chosen === 'google' ? chosen : null;
    const spec = provider ? MAPS.providers[provider].search : null;
    const keys = {
      kakao: settings.get('kakaoRestKey') ?? '',
      naverId: (settings.get('naverClientId') ?? '').trim(),
      naverSecret: settings.get('naverClientSecret') ?? '',
      google: settings.get('googleServerKey') ?? '',
    };
    const ready =
      provider !== null &&
      (settings.get(spec?.keySetting ?? '') ?? '') !== '' &&
      (provider !== 'naver' || keys.naverId !== '') &&
      (provider !== 'google' || settings.get('provider') === 'google');
    const gateway = ready && provider ? new MapSearchGateway(provider, keys) : null;
    const limit = MapPlugin.limitOf(settings.get('dailyLimit'), spec?.dailyDefault ?? 0);
    const lookup = new MapLookup(gateway, provider ?? 'none', limit);
    const attribution = spec?.attribution ?? '';
    cairn.addOperation(new SearchPlaces(lookup, provider ?? 'none', attribution));
    cairn.addOperation(new GeocodeAddress(lookup, provider ?? 'none', attribution));
    cairn.addOperation(new ReverseGeocode(lookup, provider ?? 'none', attribution));
    cairn.addOperation(new MapUsage(provider ?? 'none', ready, limit));
  }

  /** 하루 상한: 설정의 숫자, 비었거나 틀리면 회사의 기본 (providers.json의 dailyDefault) */
  static limitOf(raw: string | undefined, fallback: number): number {
    const n = Number((raw ?? '').trim());
    return (raw ?? '').trim() !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
  }
}
