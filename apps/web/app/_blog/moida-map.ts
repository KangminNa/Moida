import type { MapChoice } from './map-config';
import { MAP_DRAWS } from './moida-map-draws';

// moida.map (지도 플러그인, 2026-11-23): 앱 코드가 어느 회사 지도인지 모른 채 지도를 그리는 약속. moida.js 뒤에 붙는다.
//   moida.map.provider                 이 화면에서 쓰는 지도: osm · kakao · naver · google (관리자가 지도 플러그인에서 정한다)
//   moida.map.create(자리, { places: [{ lat, lng, name } | { address, name }], zoom?, cluster?, onSelect?(i, place) })
//     cluster: true면 핀이 많을 때 가까운 핀을 묶는다 (OSM leaflet.markercluster · 카카오 clusterer · 구글 markerclusterer,
//     네이버는 공식 묶기가 없어 그대로). 묶기 라이브러리를 못 받으면 묶지 않고 그린다 (docs/지도.md MP-3)
//     → { provider, map, sdk, select(i), update(places), pinned() }   map · sdk는 그 회사 라이브러리의 것 (더 꾸미고 싶을 때만)
//     번호 i는 늘 넘긴 목록의 번호 (주소를 못 찾아 핀이 빠져도 어긋나지 않는다). update는 지도를 두고 핀만 바꾼다 (거르기 · 찾기, 2026-11-28)
//   moida.map.search(q, { near?: { lat, lng }, size? }) → { places: [{ name, address, lat, lng, id }], provider, attribution }
//   moida.map.geocode(address) → { name, address, lat, lng, id } | null       moida.map.reverse(lat, lng) → 주소 | null
//     찾기는 서버가 지도 플러그인의 서버 키로 대신 부른다 (docs/지도.md MP-2, <앱 주소>/_/map/<동작>). 찾기를 켜지 않았으면 Error (status 404)
// 자리는 높이가 있는 요소(또는 그 선택자)다. 좌표가 있는 장소는 그대로, 주소만 있는 장소는 geocode로 좌표를 받아 핀이 된다
// (찾기를 켜지 않았거나 못 찾은 주소는 빠진다). 고른 회사의 지도를 10초 안에 받지 못하면
// OpenStreetMap으로 그리고, 그것도 못 받으면 Error를 던진다 (앱은 목록을 그대로 보여 준다).
// 브라우저에서 그대로 도는 글자다: 빌드를 거치지 않는다

const SOURCE = String.raw`(() => {
  const MAP = __MAP__;
  const fail = (message) => Object.assign(new Error(message), { status: 0, code: 'map' });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
  const LEAFLET_CLUSTER = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/';
  const GOOGLE_CLUSTER = 'https://unpkg.com/@googlemaps/markerclusterer@2.5.3/dist/index.min.js';
  const loaded = {};
  const once = (name, make) => loaded[name] || (loaded[name] = make().catch((e) => { delete loaded[name]; throw e; }));
  const tag = (name, attrs) => new Promise((resolve, reject) => {
    const el = document.createElement(name);
    if (attrs.integrity) el.crossOrigin = 'anonymous';
    // 지도 회사 · 타일은 어디서 왔는지(출처만)를 본다: 미리 보기 주소의 토큰은 경로에 있어 출처만 보내면 새지 않는다
    el.referrerPolicy = 'strict-origin';
    Object.assign(el, attrs);
    el.onload = () => resolve();
    el.onerror = () => reject(fail('지도 라이브러리를 받지 못했어요'));
    document.head.appendChild(el);
  });
  const within = (promise) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(fail('지도 라이브러리가 늦어요')), 10000)),
  ]);
  // 회사 스크립트 주소는 키를 넣어 웹이 준다 (plugins/map/providers.json). 카카오는 autoload=false 뒤 load, 구글은 callback
  const kits = {
    osm: () => once('osm', () => Promise.all([
      tag('link', { rel: 'stylesheet', href: LEAFLET + '.css', integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=' }),
      tag('script', { src: LEAFLET + '.js', integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=' }),
    ]).then(() => window.L)),
    kakao: () => once('kakao', () =>
      tag('script', { src: MAP.script })
        .then(() => new Promise((resolve) => window.kakao.maps.load(() => resolve(window.kakao.maps))))),
    naver: () => once('naver', () => tag('script', { src: MAP.script }).then(() => window.naver.maps)),
    google: () => once('google', () => new Promise((resolve, reject) => {
      window.__moidaMapReady = () => resolve(window.google.maps);
      tag('script', { src: MAP.script }).catch(reject);
    })),
  };
  // 묶기 라이브러리 (cluster: true일 때만). 카카오는 SDK 주소의 libraries=clusterer로 함께 온다
  const clusterKits = {
    osm: () => once('osm-cluster', () => Promise.all([
      tag('link', { rel: 'stylesheet', href: LEAFLET_CLUSTER + 'MarkerCluster.css', integrity: 'sha384-pmjIAcz2bAn0xukfxADbZIb3t8oRT9Sv0rvO+BR5Csr6Dhqq+nZs59P0pPKQJkEV' }),
      tag('link', { rel: 'stylesheet', href: LEAFLET_CLUSTER + 'MarkerCluster.Default.css', integrity: 'sha384-wgw+aLYNQ7dlhK47ZPK7FRACiq7ROZwgFNg0m04avm4CaXS+Z9Y7nMu8yNjBKYC+' }),
      tag('script', { src: LEAFLET_CLUSTER + 'leaflet.markercluster.js', integrity: 'sha384-eXVCORTRlv4FUUgS/xmOyr66XBVraen8ATNLMESp92FKXLAMiKkerixTiBvXriZr' }),
    ])),
    google: () => once('google-cluster', () =>
      tag('script', { src: GOOGLE_CLUSTER, integrity: 'sha384-vom+WXCyjgyG9tqI/PmE1jGpIjiUOz3kcJqG9c/+bEAt5GcEjsOiAznhho9S96nZ' })),
  };
${MAP_DRAWS}
  // 찾기: 앱 주소 아래 _/map/<동작> (moida.js가 읽은 화면 데이터의 base, 앱 도메인이면 /)
  async function ask(op, params) {
    const page = window.moida && window.moida.page;
    const base = page && typeof page.base === 'string' && page.base !== '/' ? page.base : '';
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
    const res = await fetch(base + '/_/map/' + op + '?' + query, { credentials: 'omit' });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw Object.assign(fail((body && body.message) || '찾지 못했어요'), { status: res.status });
    return body;
  }
  const search = (q, options) => {
    const o = options || {};
    return ask('search', { q, lat: o.near && o.near.lat, lng: o.near && o.near.lng, size: o.size });
  };
  const geocode = async (address) => (await ask('geocode', { address })).places[0] || null;
  const reverse = async (lat, lng) => (await ask('reverse', { lat, lng })).address;
  // 주소만 있는 장소는 좌표를 받아 핀으로. 원래 목록의 번호(i)를 붙여 돌려준다 (못 찾은 장소는 빠지고 번호는 그대로).
  // 늘 여섯씩 함께 묻는다 (2026-11-28: 넷씩 묶어 묶음마다 가장 느린 답을 기다리던 것). 하나를 찾을 때마다 found(지금까지 찾은 것).
  // 이미 찾은 주소는 서버가 기억해 상한에서 세지 않지만, 처음 찾는 주소는 한 번에 30개까지만
  // (방문자 한 곳의 분당 상한): 넘는 장소는 핀 없이 목록에만 남는다
  async function located(list, found) {
    const out = new Array(list.length).fill(null);
    const asks = [];
    list.forEach((p, i) => {
      if (!p) return;
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) out[i] = Object.assign({}, p, { i });
      else if (typeof p.address === 'string' && p.address && asks.length < 30) asks.push(i);
    });
    const now = () => out.filter(Boolean);
    if (found && now().length > 0) found(now());
    let next = 0;
    const worker = async () => {
      while (next < asks.length) {
        const i = asks[next++];
        const hit = await geocode(list[i].address).catch(() => null);
        if (!hit) continue;
        out[i] = Object.assign({}, list[i], { lat: hit.lat, lng: hit.lng, i });
        if (found) found(now());
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, asks.length) }, worker));
    return now();
  }
  // 표시 의무 (MP-3): 지도 위의 출처 · 로고는 회사 약관상 보여야 한다. 앱 CSS가 가렸으면 콘솔에 알린다 (막지는 않는다).
  // 회사 SDK의 로고 요소 이름은 정해진 약속이 아니라 OSM(Leaflet)의 출처 칸만 본다
  function watchCredit(el, provider) {
    if (provider !== 'osm') return;
    setTimeout(() => {
      const credit = el.querySelector('.leaflet-control-attribution');
      const style = credit && getComputedStyle(credit);
      const shown = credit && credit.getClientRects().length > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0.2;
      if (!shown) console.warn('[moida.map] 지도 출처 표시가 가려졌어요. 지도 회사 약관상 출처 · 로고는 지도 위에 보여야 해요');
    }, 2000);
  }
  // 그리기 (2026-11-28 빠르게): 회사 라이브러리 받기와 주소 찾기를 함께 시작하고, 첫 좌표가 나오면 바로 지도를 그린 뒤
  // 핀은 찾는 대로 붙인다(찾는 동안은 지도를 옮기지 않고, 다 찾으면 한 번 모든 핀이 보이게). create는 다 찾은 뒤에 끝난다
  async function create(target, options) {
    const opts = options || {};
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw fail('지도를 그릴 자리가 없어요');
    let list = (opts.places || []).slice();
    let provider = MAP.provider;
    const sdkReady = within(kits[provider]()).catch(async (error) => {
      if (provider === 'osm') throw error;
      provider = 'osm';
      return within(kits.osm());
    });
    sdkReady.catch(() => undefined);
    let sdk = null;
    let kit = null;
    let map = null;
    let shown = null;
    let cluster = false;
    let items = [];
    let drawing = null;
    const select = (i) => {
      if (!shown || !list[i]) return false;
      const pinned = shown.focus(i);
      if (opts.onSelect) opts.onSelect(i, list[i]);
      return pinned;
    };
    const redraw = (fit) => {
      if (!map) return;
      if (shown) shown.clear();
      shown = kit.pins(sdk, map, items, select, cluster, fit);
    };
    // 지도가 아직 없으면 라이브러리를 기다려 만든다 (한 번만). 있으면 핀만 다시 붙인다 (모아서: 잇달아 찾아도 한 번에)
    let pending = null;
    const show = (found) => {
      items = found;
      if (map) {
        if (!pending) pending = setTimeout(() => { pending = null; redraw(false); }, 120);
        return drawing;
      }
      if (!drawing)
        drawing = sdkReady.then(async (loaded) => {
          sdk = loaded;
          cluster = opts.cluster === true && clusterKits[provider]
            ? await within(clusterKits[provider]()).then(() => true, () => false)
            : opts.cluster === true;
          kit = draws[provider];
          map = kit.base(sdk, el, items[0], opts.zoom);
          redraw(true);
          watchCredit(el, provider);
        });
      return drawing;
    };
    let all = await located(list, (found) => { show(found).catch(() => undefined); });
    if (all.length === 0) throw fail('좌표가 있는 장소가 없어요');
    await show(all);
    clearTimeout(pending);
    pending = null;
    items = all;
    redraw(true);
    // 거르기 · 찾기로 장소가 바뀌면 핀만 바꾼다 (지도를 다시 만들지 않는다). 핀이 된 수를 돌려준다.
    // 잇달아 부르면 마지막 것만 그린다 (앞의 찾기가 늦게 끝나 뒤의 목록을 덮지 않게)
    let turn = 0;
    async function update(places) {
      const mine = ++turn;
      const next = (places || []).slice();
      all = await located(next);
      if (mine !== turn) return all.length;
      list = next;
      items = all;
      redraw(true);
      return items.length;
    }
    return { provider, map, sdk, select, update, pinned: () => items.map((p) => p.i) };
  }
  window.moida = Object.assign(window.moida || {}, {
    map: { provider: MAP.provider, create, search, geocode, reverse },
  });
})();
`;

/** moida.map의 글자. 이 화면에서 쓸 지도(회사 · 키를 넣은 스크립트 주소 · 타일)를 넣는다 */
export function moidaMapScript(choice: MapChoice): string {
  return SOURCE.replace('__MAP__', JSON.stringify(choice).replace(/</g, '\\u003c'));
}
