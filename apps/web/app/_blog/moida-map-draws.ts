// moida.map의 회사별 그리기 (2026-11-28 moida-map.ts에서 나눔: 300줄). 브라우저에서 그대로 도는 글자로, moida-map.ts의 SOURCE 안에 들어간다.
// 회사마다 지도 만들기(base)와 핀 놓기(pins: 목록이 바뀔 때마다 다시 불린다, fit이면 모든 핀이 보이게 옮긴다)

export const MAP_DRAWS = String.raw`
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
      pins(L, map, items, pick, cluster, fit) {
        const group = cluster && L.markerClusterGroup ? L.markerClusterGroup() : L.layerGroup();
        const marks = new Map();
        for (const p of items)
          marks.set(p.i, L.marker([p.lat, p.lng], { title: p.name || '' }).bindPopup(esc(p.name)).on('click', () => pick(p.i)).addTo(group));
        map.addLayer(group);
        if (fit && items.length > 1) map.fitBounds(L.latLngBounds(items.map((p) => [p.lat, p.lng])), { padding: [24, 24] });
        else if (fit && items.length === 1) map.panTo([items[0].lat, items[0].lng]);
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
      pins(k, map, items, pick, cluster, fit) {
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
        if (fit && items.length > 1) {
          const bounds = new k.LatLngBounds();
          for (const p of items) bounds.extend(at(p));
          map.setBounds(bounds);
        } else if (fit && items.length === 1) map.panTo(at(items[0]));
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
      pins(n, map, items, pick, cluster, fit) {
        const at = (p) => new n.LatLng(p.lat, p.lng);
        const info = new n.InfoWindow({ content: '' });
        const marks = new Map();
        for (const p of items) {
          const m = new n.Marker({ map, position: at(p), title: p.name || '' });
          n.Event.addListener(m, 'click', () => pick(p.i));
          marks.set(p.i, { m, p });
        }
        if (fit && items.length > 1) {
          const bounds = new n.LatLngBounds(at(items[0]), at(items[0]));
          for (const p of items) bounds.extend(at(p));
          map.fitBounds(bounds);
        } else if (fit && items.length === 1) map.panTo(at(items[0]));
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
      pins(g, map, items, pick, cluster, fit) {
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
        if (fit && items.length > 1) {
          const bounds = new g.LatLngBounds();
          for (const p of items) bounds.extend(at(p));
          map.fitBounds(bounds);
        } else if (fit && items.length === 1) map.panTo(at(items[0]));
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
`;
