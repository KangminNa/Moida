// moida.js의 장소 부품 (2026-11-28): <moida-place-list> · <moida-map>. 지도 앱 본보기(moida-make 스킬 map-app.md)를 태그 한 줄로.
//   <moida-place-list src="places.json"> 또는 table="places"(앱 데이터 표)  [cluster] [map-height="50vh"]
//     목록을 먼저 그리고 지도(moida.map)를 얹는다. 분류 칩(category가 둘 이상일 때) · 글자 거르기(이름 · 주소 · 메모),
//     목록 ↔ 핀 고르기, 지도를 못 그리면 목록과 카카오맵 · 네이버 지도 링크만. 알림: moida:ready {places, pinned} · moida:select {index, place}
//   <moida-map src="places.json" [cluster] [map-height]>  핀만 있는 지도. 알림: moida:ready {pinned} · moida:select
// 장소 하나: { name, address?, category?, note?, lat?, lng? }. 좌표가 없으면 주소로 찾는다 (moida.map의 약속).
// UI_BASE(moida-ui-base.ts)와 한 함수 안에서 이어 붙는다: el · emit · listOf · define · smooth를 그대로 쓴다

export const UI_PLACES = String.raw`
  function links(place) {
    const box = el('p', 'moida-links');
    for (const [label, url] of [
      ['카카오맵', 'https://map.kakao.com/link/search/' + encodeURIComponent(place.name)],
      ['네이버 지도', 'https://map.naver.com/p/search/' + encodeURIComponent(place.name)],
    ]) {
      const a = el('a', '', label);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      box.append(a);
    }
    return box;
  }
  function mapHeight(node) {
    const h = node.getAttribute('map-height');
    if (h && /^[0-9.]+(px|vh|dvh|rem|%)$/.test(h)) node.style.setProperty('--moida-map-height', h);
  }
  async function drawMap(node, box, places, onSelect) {
    if (!M.map) throw new Error('지도를 쓸 수 없어요');
    const cluster = node.hasAttribute('cluster') || places.length > 30;
    return M.map.create(box, { places, cluster, onSelect });
  }

  define('moida-place-list', () => class extends HTMLElement {
    connectedCallback() {
      if (this.started) return;
      this.started = true;
      this.kind = '전체';
      this.query = '';
      this.all = [];
      this.shown = [];
      this.map = null;
      mapHeight(this);
      this.chips = el('div', 'moida-chips');
      this.chips.setAttribute('role', 'group');
      this.chips.setAttribute('aria-label', '분류');
      this.find = el('input', 'moida-find');
      this.find.type = 'search';
      this.find.placeholder = '이름 · 주소로 거르기';
      this.find.setAttribute('aria-label', '장소 거르기');
      const tools = el('div', 'moida-tools');
      tools.append(this.chips, this.find);
      this.mapBox = el('div', 'moida-map');
      this.note = el('p', 'moida-note', '지도를 불러오는 중…');
      this.note.setAttribute('aria-live', 'polite');
      const mapSide = el('div', 'moida-mapbox');
      mapSide.append(this.mapBox, this.note);
      this.count = el('p', 'moida-count', '불러오는 중…');
      this.count.setAttribute('aria-live', 'polite');
      this.list = el('ol', 'moida-places');
      const listSide = el('div', 'moida-listbox');
      listSide.append(this.count, this.list);
      const split = el('div', 'moida-split');
      split.append(mapSide, listSide);
      this.replaceChildren(tools, split);
      let wait = 0;
      this.find.addEventListener('input', () => {
        clearTimeout(wait);
        wait = setTimeout(() => {
          this.query = this.find.value;
          this.apply();
        }, 250);
      });
      this.start();
    }
    matches(p) {
      const q = this.query.trim().toLowerCase();
      const kindOk = this.kind === '전체' || p.category === this.kind;
      return kindOk && (!q || [p.name, p.address, p.note].some((t) => String(t || '').toLowerCase().includes(q)));
    }
    drawChips() {
      const kinds = ['전체', ...new Set(this.all.map((p) => p.category).filter(Boolean))];
      this.chips.replaceChildren();
      if (kinds.length <= 2) return;
      for (const k of kinds) {
        const b = el('button', 'moida-chip', k);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(k === this.kind));
        b.addEventListener('click', () => {
          this.kind = k;
          this.drawChips();
          this.apply();
        });
        this.chips.append(b);
      }
    }
    drawList() {
      this.list.replaceChildren();
      this.count.textContent = this.shown.length > 0 ? this.shown.length + '곳' : '맞는 장소가 없어요';
      this.shown.forEach((p, i) => {
        const li = el('li', 'moida-place');
        li.dataset.i = String(i);
        const name = el('button', 'moida-place-name', p.name);
        name.type = 'button';
        name.addEventListener('click', () => (this.map ? this.map.select(i) : this.mark(i)));
        li.append(name, el('p', 'moida-meta', [p.category, p.address].filter(Boolean).join(' · ')));
        if (p.note) li.append(el('p', 'moida-meta', p.note));
        li.append(links(p));
        this.list.append(li);
      });
    }
    // 고른 장소를 목록에 표시한다 (목록 · 핀 모두 여기로 온다)
    mark(i, fromMap) {
      for (const li of this.list.children) {
        const on = Number(li.dataset.i) === i;
        li.classList.toggle('is-on', on);
        if (on && fromMap) li.scrollIntoView({ block: 'nearest', behavior: smooth() ? 'smooth' : 'auto' });
      }
      emit(this, 'select', { index: i, place: this.shown[i] });
    }
    pinNote(pinned) {
      const missing = this.shown.length - pinned;
      this.note.textContent = missing > 0 ? missing + '곳은 위치를 찾지 못해 목록에만 있어요' : '';
    }
    async apply() {
      this.shown = this.all.filter((p) => this.matches(p));
      this.drawList();
      if (this.map) this.pinNote(await this.map.update(this.shown));
    }
    async start() {
      try {
        this.all = (await listOf(this)).filter((p) => typeof p.name === 'string');
      } catch (error) {
        this.count.textContent = error.message;
        this.note.textContent = '';
        return;
      }
      this.drawChips();
      this.shown = this.all.filter((p) => this.matches(p));
      this.drawList();
      const first = this.shown;
      try {
        this.map = await drawMap(this, this.mapBox, first, (i) => this.mark(i, true));
        this.pinNote(this.map.pinned().length);
        if (this.shown !== first) this.apply();
      } catch {
        this.classList.add('no-map');
        this.note.textContent = '지도를 불러오지 못했어요. 목록의 지도 링크로 보세요';
      }
      emit(this, 'ready', { places: this.all, pinned: this.map ? this.map.pinned().length : 0 });
    }
  });

  define('moida-map', () => class extends HTMLElement {
    connectedCallback() {
      if (this.started) return;
      this.started = true;
      mapHeight(this);
      const box = el('div', 'moida-map');
      const note = el('p', 'moida-note');
      note.setAttribute('aria-live', 'polite');
      this.replaceChildren(box, note);
      listOf(this)
        .then((places) => drawMap(this, box, places, (i, place) => emit(this, 'select', { index: i, place })))
        .then((map) => emit(this, 'ready', { pinned: map.pinned().length }))
        .catch(() => {
          box.remove();
          note.textContent = '지도를 불러오지 못했어요';
        });
    }
  });
`;
