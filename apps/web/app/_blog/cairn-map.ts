import type { MapChoice } from './map-config';

// cairn.map (지도 플러그인, 2026-11-23): 앱 코드가 어느 회사 지도인지 모른 채 지도를 그리는 약속. cairn.js 뒤에 붙는다.
//   cairn.map.provider                 이 화면에서 쓰는 지도: osm · kakao · naver · google (관리자가 지도 플러그인에서 정한다)
//   cairn.map.create(자리, { places: [{ lat, lng, name } | { address, name }], zoom?, cluster?, onSelect?(i, place) })
//     cluster: true면 핀이 많을 때 가까운 핀을 묶는다 (OSM leaflet.markercluster · 카카오 clusterer · 구글 markerclusterer,
//     네이버는 공식 묶기가 없어 그대로). 묶기 라이브러리를 못 받으면 묶지 않고 그린다 (docs/지도.md MP-3)
//     → { provider, map, sdk, select(i) }   map · sdk는 그 회사 라이브러리의 것 (더 꾸미고 싶을 때만)
//   cairn.map.search(q, { near?: { lat, lng }, size? }) → { places: [{ name, address, lat, lng, id }], provider, attribution }
//   cairn.map.geocode(address) → { name, address, lat, lng, id } | null       cairn.map.reverse(lat, lng) → 주소 | null
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
      window.__cairnMapReady = () => resolve(window.google.maps);
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
  const draws = {
    osm(L, el, places, pick, zoom, cluster) {
      const map = L.map(el, { scrollWheelZoom: false });
      // 타일은 관리자가 고른 것 (providers.json의 tiles). 출처 표시는 지도 위에 남긴다 (OSM 타일 정책)
      L.tileLayer(MAP.tiles.url, {
        subdomains: MAP.tiles.subdomains || 'abc', maxZoom: MAP.tiles.maxZoom,
        attribution: MAP.tiles.attribution, referrerPolicy: 'strict-origin',
      }).addTo(map);
      const group = cluster && L.markerClusterGroup ? L.markerClusterGroup() : null;
      const pins = places.map((p, i) => L.marker([p.lat, p.lng], { title: p.name || '' })
        .addTo(group || map).bindPopup(esc(p.name)).on('click', () => pick(i)));
      if (group) map.addLayer(group);
      if (places.length > 1) map.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng])), { padding: [24, 24] });
      else map.setView([places[0].lat, places[0].lng], zoom || 15);
      return { map, focus: (i) => {
        if (group) group.zoomToShowLayer(pins[i], () => pins[i].openPopup());
        else { map.panTo([places[i].lat, places[i].lng]); pins[i].openPopup(); }
      } };
    },
    kakao(k, el, places, pick, zoom, cluster) {
      const at = (p) => new k.LatLng(p.lat, p.lng);
      const map = new k.Map(el, { center: at(places[0]), level: zoom ? Math.max(1, 20 - zoom) : 4 });
      const info = new k.InfoWindow({ removable: false });
      const grouped = cluster && k.MarkerClusterer;
      const pins = places.map((p, i) => {
        const pin = new k.Marker({ map: grouped ? null : map, position: at(p), title: p.name || '' });
        k.event.addListener(pin, 'click', () => pick(i));
        return pin;
      });
      if (grouped) new k.MarkerClusterer({ map, markers: pins, averageCenter: true, minLevel: 6 });
      if (places.length > 1) {
        const bounds = new k.LatLngBounds();
        for (const p of places) bounds.extend(at(p));
        map.setBounds(bounds);
      }
      return { map, focus: (i) => {
        if (grouped && map.getLevel() > 5) map.setLevel(3);
        map.panTo(at(places[i]));
        info.setContent('<div style="padding:4px 8px;white-space:nowrap">' + esc(places[i].name) + '</div>');
        info.open(map, pins[i]);
      } };
    },
    naver(n, el, places, pick, zoom) {
      const at = (p) => new n.LatLng(p.lat, p.lng);
      const map = new n.Map(el, { center: at(places[0]), zoom: zoom || 15 });
      const info = new n.InfoWindow({ content: '' });
      const pins = places.map((p, i) => {
        const pin = new n.Marker({ map, position: at(p), title: p.name || '' });
        n.Event.addListener(pin, 'click', () => pick(i));
        return pin;
      });
      if (places.length > 1) {
        const bounds = new n.LatLngBounds(at(places[0]), at(places[0]));
        for (const p of places) bounds.extend(at(p));
        map.fitBounds(bounds);
      }
      return { map, focus: (i) => {
        map.panTo(at(places[i]));
        info.setContent('<div style="padding:4px 8px">' + esc(places[i].name) + '</div>');
        info.open(map, pins[i]);
      } };
    },
    google(g, el, places, pick, zoom, cluster) {
      const at = (p) => ({ lat: p.lat, lng: p.lng });
      const map = new g.Map(el, { center: at(places[0]), zoom: zoom || 15, mapTypeControl: false });
      const info = new g.InfoWindow();
      const kit = cluster && window.markerClusterer;
      const pins = places.map((p, i) => {
        const pin = new g.Marker({ map: kit ? null : map, position: at(p), title: p.name || '' });
        pin.addListener('click', () => pick(i));
        return pin;
      });
      if (kit) new kit.MarkerClusterer({ map, markers: pins });
      if (places.length > 1) {
        const bounds = new g.LatLngBounds();
        for (const p of places) bounds.extend(at(p));
        map.fitBounds(bounds);
      }
      return { map, focus: (i) => {
        if (kit && map.getZoom() < 16) map.setZoom(16);
        map.panTo(at(places[i]));
        info.setContent(document.createTextNode(String(places[i].name || '')));
        info.open({ map, anchor: pins[i] });
      } };
    },
  };
  // 찾기: 앱 주소 아래 _/map/<동작> (cairn.js가 읽은 화면 데이터의 base, 앱 도메인이면 /)
  async function ask(op, params) {
    const page = window.cairn && window.cairn.page;
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
  // 주소만 있는 장소는 좌표를 받아 핀으로 (한 번에 몇 개씩: 서버의 곳마다 분당 상한이 있다)
  async function located(list) {
    const out = [];
    for (const p of list) {
      if (!p) continue;
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) out.push(p);
      else if (typeof p.address === 'string' && p.address && out.length < 30) {
        const found = await geocode(p.address).catch(() => null);
        if (found) out.push(Object.assign({}, p, { lat: found.lat, lng: found.lng }));
      }
    }
    return out;
  }
  // 표시 의무 (MP-3): 지도 위의 출처 · 로고는 회사 약관상 보여야 한다. 앱 CSS가 가렸으면 콘솔에 알린다 (막지는 않는다).
  // 회사 SDK의 로고 요소 이름은 정해진 약속이 아니라 OSM(Leaflet)의 출처 칸만 본다
  function watchCredit(el, provider) {
    if (provider !== 'osm') return;
    setTimeout(() => {
      const credit = el.querySelector('.leaflet-control-attribution');
      const style = credit && getComputedStyle(credit);
      const shown = credit && credit.getClientRects().length > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0.2;
      if (!shown) console.warn('[cairn.map] 지도 출처 표시가 가려졌어요. 지도 회사 약관상 출처 · 로고는 지도 위에 보여야 해요');
    }, 2000);
  }
  async function create(target, options) {
    const opts = options || {};
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw fail('지도를 그릴 자리가 없어요');
    const places = await located(opts.places || []);
    if (places.length === 0) throw fail('좌표가 있는 장소가 없어요');
    let provider = MAP.provider;
    let sdk;
    try {
      sdk = await within(kits[provider]());
    } catch (error) {
      if (provider === 'osm') throw error;
      provider = 'osm';
      sdk = await within(kits.osm());
    }
    let view = null;
    const pick = (i) => {
      if (!view || !places[i]) return;
      view.focus(i);
      if (opts.onSelect) opts.onSelect(i, places[i]);
    };
    const cluster = opts.cluster === true && clusterKits[provider]
      ? await within(clusterKits[provider]()).then(() => true, () => false)
      : opts.cluster === true;
    view = draws[provider](sdk, el, places, pick, opts.zoom, cluster);
    watchCredit(el, provider);
    return { provider, map: view.map, sdk, select: pick };
  }
  window.cairn = Object.assign(window.cairn || {}, {
    map: { provider: MAP.provider, create, search, geocode, reverse },
  });
})();
`;

/** cairn.map의 글자. 이 화면에서 쓸 지도(회사 · 키를 넣은 스크립트 주소 · 타일)를 넣는다 */
export function cairnMapScript(choice: MapChoice): string {
  return SOURCE.replace('__MAP__', JSON.stringify(choice).replace(/</g, '\\u003c'));
}
