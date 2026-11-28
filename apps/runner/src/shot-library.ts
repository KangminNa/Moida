// 결과 화면 찍기의 moida.js 대신 쓰는 것 (2026-11-28). 칸의 러너는 웹에 닿지 않아(MOIDA_RUNNER_URL은 API 서버) 진짜 moida.js를 받지 못한다.
// 그래서 같은 이름(moida.open · page · data · me · login · from · community · map, 부품 <moida-place-list> · <moida-map> ·
// <moida-account> · <moida-rows>)을 예시 데이터로 채운다. 지도는 회사 SDK 대신 격자와 번호 점을 그린다 (지도 자리가 비어 보이지 않게).
// 부품은 진짜와 같은 클래스(moida-place · moida-map …)로 그리되 모양은 비슷할 뿐이다: 진짜 부품의 모양은 이 그림으로 판단하지 않는다.
// 자리의 크기가 0이면 window.__moidaShot.empty에 적는다 (찍기가 "빈 지도 자리"로 알린다). 브라우저에서 그대로 도는 글자다
export const SHOT_LIBRARY = String.raw`(() => {
  const shot = (window.__moidaShot = window.__moidaShot || { empty: [] });
  const SAMPLE = [
    { name: '예시 장소 하나', category: '카페', address: '서울 성동구 예시로 1', note: '예시 메모' },
    { name: '예시 장소 둘', category: '식당', address: '서울 성동구 예시로 2' },
    { name: '예시 장소 셋', category: '카페', address: '서울 성동구 예시로 3' },
  ];
  const POSTS = [1, 2, 3].map((n) => ({
    title: '예시 글 ' + n,
    slug: 'sample-' + n,
    summary: '결과 화면을 찍으려고 넣은 예시 글이에요.',
    publishedAt: '2026-11-2' + n + 'T09:00:00Z',
  }));
  const label = (node) => node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\s+/).join('.') : '');
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  /** 지도 대신: 격자 위에 번호 점. 자리의 높이가 없으면 적어 둔다 (진짜 지도도 보이지 않는다) */
  function drawMap(box, places) {
    const r = box.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) shot.empty.push(label(box) + ' (지도 자리의 크기가 ' + Math.round(r.width) + '×' + Math.round(r.height) + ')');
    box.replaceChildren();
    box.style.position = box.style.position || 'relative';
    box.style.backgroundColor = box.style.backgroundColor || '#e8ecef';
    box.style.backgroundImage = 'linear-gradient(#d5dbe0 1px, transparent 1px), linear-gradient(90deg, #d5dbe0 1px, transparent 1px)';
    box.style.backgroundSize = '32px 32px';
    box.setAttribute('data-moida-shot', 'map');
    places.forEach((p, i) => {
      const dot = el('span', 'moida-shot-pin', i + 1);
      dot.title = p.name || '';
      dot.style.cssText = 'position:absolute;width:24px;height:24px;border-radius:50%;background:#2563eb;color:#fff;font:600 12px/24px sans-serif;text-align:center;left:' + (15 + ((i * 37) % 70)) + '%;top:' + (20 + ((i * 23) % 60)) + '%';
      box.append(dot);
    });
  }
  const map = {
    provider: 'sample',
    async create(target, options) {
      const box = typeof target === 'string' ? document.querySelector(target) : target;
      if (!box) throw new Error('지도 자리를 찾지 못했어요: ' + target);
      let places = (options && options.places) || [];
      drawMap(box, places);
      const onSelect = options && options.onSelect;
      return {
        provider: 'sample',
        map: null,
        sdk: null,
        select: (i) => (onSelect && places[i] ? (onSelect(i, places[i]), true) : false),
        update: async (next) => {
          places = next || [];
          drawMap(box, places);
        },
        pinned: () => places.map((_, i) => i),
      };
    },
    search: async () => SAMPLE,
    geocode: async () => SAMPLE.map((p, i) => ({ address: p.address, found: true, lat: 37.54 + i / 100, lng: 127.05 })),
    reverse: async () => ({ address: SAMPLE[0].address }),
  };
  function from() {
    const query = {
      select: () => query, eq: () => query, neq: () => query, gt: () => query, gte: () => query,
      lt: () => query, lte: () => query, order: () => query, limit: () => query, mine: () => query,
      then: (done, failed) => Promise.resolve({ rows: [], more: false }).then(done, failed),
      insert: async (row) => ({ row: { id: 'sample', ...row } }),
      update: async (id, row) => ({ row: { id, ...row } }),
      delete: async () => ({}),
    };
    return query;
  }
  const page = (() => {
    try {
      const block = document.getElementById('moida-data');
      return block ? JSON.parse(block.textContent || 'null') : { base: '', posts: POSTS };
    } catch {
      return null;
    }
  })();
  window.moida = {
    open: true,
    page,
    data: async (path) => (String(path || '').startsWith('posts/') ? { post: { ...POSTS[0], body: '<p>예시 본문이에요.</p>' } } : { posts: POSTS, more: false }),
    me: async () => ({ member: null }),
    login: () => {},
    join: () => {},
    logout: async () => {},
    from,
    community: {
      topics: async () => ({ topics: [], more: false }),
      topic: async () => null,
      write: async () => ({}), edit: async () => ({}), remove: async () => ({}),
      comment: async () => ({}), removeComment: async () => ({}), report: async () => ({}),
    },
    map,
  };
  async function listOf(node) {
    const src = node.getAttribute('src');
    if (!src) return SAMPLE;
    try {
      const res = await fetch(src);
      const body = await res.json();
      return Array.isArray(body) ? body : SAMPLE;
    } catch {
      return SAMPLE;
    }
  }
  const define = (name, make) => customElements.get(name) || customElements.define(name, make());
  define('moida-place-list', () => class extends HTMLElement {
    async connectedCallback() {
      const places = await listOf(this);
      const height = this.getAttribute('map-height');
      const box = el('div', 'moida-map');
      box.style.height = height || '42vh';
      box.style.minHeight = '240px';
      const list = el('ol', 'moida-places');
      for (const p of places.slice(0, 30)) {
        const li = el('li', 'moida-place');
        li.append(el('button', 'moida-place-name', p.name), el('p', 'moida-meta', [p.category, p.address].filter(Boolean).join(' · ')));
        list.append(li);
      }
      const split = el('div', 'moida-split');
      split.style.cssText = 'display:grid;gap:12px;grid-template-columns:' + (innerWidth >= 900 ? 'minmax(0,1fr) minmax(280px,400px)' : 'minmax(0,1fr)');
      split.append(box, list);
      this.replaceChildren(split);
      drawMap(box, places);
    }
  });
  define('moida-map', () => class extends HTMLElement {
    async connectedCallback() {
      const box = el('div', 'moida-map');
      box.style.height = this.getAttribute('map-height') || '320px';
      this.replaceChildren(box);
      drawMap(box, await listOf(this));
    }
  });
  define('moida-account', () => class extends HTMLElement {
    connectedCallback() {
      const wrap = el('div', 'moida-account');
      wrap.append(el('button', 'moida-button is-main', '로그인'), el('button', 'moida-button', '가입'));
      this.replaceChildren(wrap);
    }
  });
  define('moida-rows', () => class extends HTMLElement {
    connectedCallback() {
      const template = this.querySelector('template');
      if (!template) return;
      for (let n = 1; n <= 3; n++) {
        const copy = template.content.cloneNode(true);
        for (const field of copy.querySelectorAll('[data-field]')) field.textContent = '예시 ' + field.getAttribute('data-field') + ' ' + n;
        this.append(copy);
      }
    }
  });
})();
`;
