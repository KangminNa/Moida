import type { MapChoice } from './map-config';

// cairn.map (지도 플러그인, 2026-11-23): 앱 코드가 어느 회사 지도인지 모른 채 지도를 그리는 약속. cairn.js 뒤에 붙는다.
//   cairn.map.provider                 이 화면에서 쓰는 지도: osm · kakao · naver · google (관리자가 지도 플러그인에서 정한다)
//   cairn.map.create(자리, { places: [{ lat, lng, name } | { address, name }], zoom?, cluster?, onSelect?(i, place) })
//     cluster: true면 핀이 많을 때 가까운 핀을 묶는다 (OSM leaflet.markercluster · 카카오 clusterer · 구글 markerclusterer,
//     네이버는 공식 묶기가 없어 그대로). 묶기 라이브러리를 못 받으면 묶지 않고 그린다 (docs/지도.md MP-3)
//     → { provider, map, sdk, select(i), update(places), pinned() }   map · sdk는 그 회사 라이브러리의 것 (더 꾸미고 싶을 때만)
//     번호 i는 늘 넘긴 목록의 번호 (주소를 못 찾아 핀이 빠져도 어긋나지 않는다). update는 지도를 두고 핀만 바꾼다 (거르기 · 찾기, 2026-11-28)
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
  // 회사마다: 지도 만들기(base)와 핀 놓기(pins). pins는 장소 목록이 바뀔 때마다(update) 다시 불린다.
  // 핀마다 원래 목록의 번호(i)를 들고 다녀, 주소를 못 찾아 빠진 장소가 있어도 목록과 핀의 번호가 같다
  const draws = {
    osm: {
      base(L, el, first, zoom) {
        const map = L.map(el, { scrollWheelZoom: false });
        // 타일은 관리자가 고른 것 (providers.json의 tiles). 출처 표시는 지도 위에 남긴다 (OSM 타일 정책)
        L.tileLayer(MAP.tiles.url, {
          subdomains: MAP.tiles.subdomains || 'abc', maxZoom: MAP.tiles.maxZoom,
          attribution: MAP.tiles.attribution, referrerPolicy: 'strict-origin',
        }).addTo(map);
        map.setView([first.lat, first.lng], zoom || 15);
        return map;
      },
      pins(L, map, items, pick, cluster) {
        const group = cluster && L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
        const marks = new Map();
        for (const p of items)
          marks.set(p.i, L.marker([p.lat, p.lng], { title: p.name || '' }).bindPopup(esc(p.name)).on('click', () => pick(p.i)).addTo(group));
        map.addLayer(group);
        if (items.length > 1) map.fitBounds(L.latLngBounds(items.map((p) => [p.lat, p.lng])), { padding: [24, 24] });
        else if (items.length === 1) map.panTo([items[0].lat, items[0].lng]);
        return {
          focus(i) {
            const m = marks.get(i);
            if (!m) return false;
            if (group.zoomToShowLayer) group.zoomToShowLayer(m, () => m.openPopup());
            else { map.panTo(m.getLatLng()); m.openPopup(); }
            return true;
          },
          clear() { map.removeLayer(group); },
        };
      },
    },
    kakao: {
      base(k, el, first, zoom) {
        return new k.Map(el, { center: new k.LatLng(first.lat, first.lng), level: zoom ? Math.max(1, 20 - zoom) : 4 });
      },
      pins(k, map, items, pick, cluster) {
        const at = (p) => new k.LatLng(p.lat, p.lng);
        const info = new k.InfoWindow({ removable: false });
        const group = cluster && k.MarkerClusterer ? new k.MarkerClusterer({ map, averageCenter: true, minLevel: 6 }) : null;
        const marks = new Map();
        for (const p of items) {
          const m = new k.Marker({ map: group ? null : map, position: at(p), title: p.name || '' });
          k.event.addListener(m, 'click', () => pick(p.i));
          marks.set(p.i, { m, p });
        }
        if (group) group.addMarkers([...marks.values()].map((x) => x.m));
        if (items.length > 1) {
          const bounds = new k.LatLngBounds();
          for (const p of items) bounds.extend(at(p));
          map.setBounds(bounds);
        } else if (items.length === 1) map.panTo(at(items[0]));
        return {
          focus(i) {
            const x = marks.get(i);
            if (!x) return false;
            if (group && map.getLevel() > 5) map.setLevel(3);
            map.panTo(at(x.p));
            info.setContent('<div style="padding:4px 8px;white-space:nowrap">' + esc(x.p.name) + '</div>');
            info.open(map, x.m);
            return true;
          },
          clear() {
            info.close();
            if (group) group.clear();
            for (const x of marks.values()) x.m.setMap(null);
          },
        };
      },
    },
    naver: {
      base(n, el, first, zoom) {
        return new n.Map(el, { center: new n.LatLng(first.lat, first.lng), zoom: zoom || 15 });
      },
      pins(n, map, items, pick) {
        const at = (p) => new n.LatLng(p.lat, p.lng);
        const info = new n.InfoWindow({ content: '' });
        const marks = new Map();
        for (const p of items) {
          const m = new n.Marker({ map, position: at(p), title: p.name || '' });
          n.Event.addListener(m, 'click', () => pick(p.i));
          marks.set(p.i, { m, p });
        }
        if (items.length > 1) {
          const bounds = new n.LatLngBounds(at(items[0]), at(items[0]));
          for (const p of items) bounds.extend(at(p));
          map.fitBounds(bounds);
        } else if (items.length === 1) map.panTo(at(items[0]));
        return {
          focus(i) {
            const x = marks.get(i);
            if (!x) return false;
            map.panTo(at(x.p));
            info.setContent('<div style="padding:4px 8px">' + esc(x.p.name) + '</div>');
            info.open(map, x.m);
            return true;
          },
          clear() {
            info.close();
            for (const x of marks.values()) x.m.setMap(null);
          },
        };
      },
    },
    google: {
      base(g, el, first, zoom) {
        return new g.Map(el, { center: { lat: first.lat, lng: first.lng }, zoom: zoom || 15, mapTypeControl: false });
      },
      pins(g, map, items, pick, cluster) {
        const at = (p) => ({ lat: p.lat, lng: p.lng });
        const info = new g.InfoWindow();
        const kit = cluster && window.markerClusterer;
        const marks = new Map();
        for (const p of items) {
          const m = new g.Marker({ map: kit ? null : map, position: at(p), title: p.name || '' });
          m.addListener('click', () => pick(p.i));
          marks.set(p.i, { m, p });
        }
        const group = kit ? new kit.MarkerClusterer({ map, markers: [...marks.values()].map((x) => x.m) }) : null;
        if (items.length > 1) {
          const bounds = new g.LatLngBounds();
          for (const p of items) bounds.extend(at(p));
          map.fitBounds(bounds);
        } else if (items.length === 1) map.panTo(at(items[0]));
        return {
          focus(i) {
            const x = marks.get(i);
            if (!x) return false;
            if (group && map.getZoom() < 16) map.setZoom(16);
            map.panTo(at(x.p));
            info.setContent(document.createTextNode(String(x.p.name || '')));
            info.open({ map, anchor: x.m });
            return true;
          },
          clear() {
            info.close();
            if (group) group.clearMarkers();
            for (const x of marks.values()) x.m.setMap(null);
          },
        };
      },
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
  // 주소만 있는 장소는 좌표를 받아 핀으로. 원래 목록의 번호(i)를 붙여 돌려준다 (못 찾은 장소는 빠지고 번호는 그대로).
  // 넷씩 함께 묻는다. 이미 찾은 주소는 서버가 기억해 상한에서 세지 않지만, 처음 찾는 주소는 한 번에 30개까지만
  // (방문자 한 곳의 분당 상한): 넘는 장소는 핀 없이 목록에만 남는다
  async function located(list) {
    const out = new Array(list.length).fill(null);
    const asks = [];
    list.forEach((p, i) => {
      if (!p) return;
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) out[i] = Object.assign({}, p, { i });
      else if (typeof p.address === 'string' && p.address && asks.length < 30) asks.push(i);
    });
    for (let n = 0; n < asks.length; n += 4)
      await Promise.all(asks.slice(n, n + 4).map(async (i) => {
        const found = await geocode(list[i].address).catch(() => null);
        if (found) out[i] = Object.assign({}, list[i], { lat: found.lat, lng: found.lng, i });
      }));
    return out.filter(Boolean);
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
    let list = (opts.places || []).slice();
    let items = await located(list);
    if (items.length === 0) throw fail('좌표가 있는 장소가 없어요');
    let provider = MAP.provider;
    let sdk;
    try {
      sdk = await within(kits[provider]());
    } catch (error) {
      if (provider === 'osm') throw error;
      provider = 'osm';
      sdk = await within(kits.osm());
    }
    const cluster = opts.cluster === true && clusterKits[provider]
      ? await within(clusterKits[provider]()).then(() => true, () => false)
      : opts.cluster === true;
    const kit = draws[provider];
    const map = kit.base(sdk, el, items[0], opts.zoom);
    let shown = null;
    // 번호는 늘 create · update에 넘긴 목록의 번호다. 핀이 없는 장소면 false (지도는 그대로)
    const select = (i) => {
      if (!shown || !list[i]) return false;
      const pinned = shown.focus(i);
      if (opts.onSelect) opts.onSelect(i, list[i]);
      return pinned;
    };
    shown = kit.pins(sdk, map, items, select, cluster);
    watchCredit(el, provider);
    // 거르기 · 찾기로 장소가 바뀌면 핀만 바꾼다 (지도를 다시 만들지 않는다). 핀이 된 수를 돌려준다
    async function update(places) {
      list = (places || []).slice();
      items = await located(list);
      shown.clear();
      shown = kit.pins(sdk, map, items, select, cluster);
      return items.length;
    }
    return { provider, map, sdk, select, update, pinned: () => items.map((p) => p.i) };
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
