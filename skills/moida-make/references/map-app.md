# 지도 앱 (<moida-place-list> · moida.map 본보기)

장소가 중심인 **앱**(맛집 · 코스 · 매장 · 여행 · 동네 안내)은 부품 `<moida-place-list>` 한 줄로 시작한다. 페이지(AI가 만든 HTML)의 지도는 [map.md](map.md)다.

## 먼저: 부품 한 줄 (기본)

부품은 아래 "모양"을 모두 갖췄다 (목록 먼저 · 분류 칩 · 거르기 · 목록 ↔ 핀 · 30곳 넘으면 묶기 · 지도를 못 그리면 목록과 지도 링크). 파일은 `moida.json` · `index.html` · `places.json` (+ `design.md`, 꾸밀 `style.css`).

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>성수 나들이</title>
  <link rel="stylesheet" href="style.css">
  <script src="_/moida.js" defer></script>
</head>
<body>
  <header class="head"><h1>성수 나들이</h1><p>걸어서 도는 하루 코스</p></header>
  <main>
    <moida-place-list src="places.json"></moida-place-list>
  </main>
</body>
</html>
```

- 앱 데이터 표에 둔 목록이면 `src` 대신 `table="places"`. 지도 높이는 `map-height="50vh"`, 적어도 묶으려면 `cluster`.
- 꾸밈은 `style.css`의 `:root` 토큰(`--accent` · `--surface` · `--space-*` …)과 `.moida-place` · `.moida-chip` 같은 클래스로 한다 (부품은 그림자 DOM 없이 그린다).
- 고른 장소로 다른 것을 할 때만 스크립트: `document.querySelector('moida-place-list').addEventListener('moida:select', (e) => …e.detail.place)`.
- 목록 한 줄에 가격 · 사진 · 시간처럼 부품에 없는 칸이 꼭 필요하면 아래 본보기를 직접 짠다.

## 직접 짤 때 (본보기)

본보기는 실제 브라우저에서 확인한 것이다 (2026-11-28: 데스크톱 · 폰 · 지도를 못 받을 때, 거르기 · 목록 ↔ 핀 고르기). 새로 짓지 말고 파일 다섯을 그대로 낸 뒤 바꾸는 곳만 바꾼다.

### 모양 (정해 둔 것, 부품도 같다)

- **정적 앱**이다 (`moida.json`의 `"render": "static"`): 파일 `moida.json` · `index.html` · `style.css` · `app.js` · `places.json` (+ 디자인 문서 `design.md`). 폴더가 없으니 결과물 폴더에 그대로 둔다.
- **목록이 먼저다.** 장소 목록을 그린 뒤 지도를 얹는다. 지도를 못 그려도(지도 회사 · 키 · 네트워크) 목록과 장소마다의 카카오맵 · 네이버 지도 링크로 쓸 수 있어야 한다.
- 넓은 화면은 왼쪽 지도(따라 내려옴) · 오른쪽 목록, 폰은 위 지도(화면 높이의 42%) · 아래 목록.
- 분류 칩(분류가 둘 이상일 때만)과 글자 거르기(이름 · 주소 · 메모). 거르면 목록을 다시 그리고 지도는 **핀만** 바꾼다 (`update`).
- 목록의 이름을 누르면 지도의 그 핀이 열리고, 핀을 누르면 목록의 그 줄이 표시되고 보이는 곳으로 내려온다. 번호는 늘 지금 보이는 목록(`state.shown`)의 번호다.
- 장소가 30곳을 넘으면 핀을 묶는다 (`cluster`).

## 데이터 둘 곳

| 장소 목록이 | 둘 곳 | 이유 |
|---|---|---|
| 관리자가 정하고 가끔 바뀐다 (대부분) | 묶음의 `places.json` | 바꾸면 앱 코드의 새 버전이 되어 승인을 거친다. 따로 넣을 일이 없다 |
| 회원이 더하거나, 관리자가 자주 더한다 | 앱 데이터 표 `places` (`read: "anyone"`, `write: "admin"` 또는 `"member"`) | 부품이면 `table="places"`, 직접 짠 본보기면 `loadPlaces`만 바꾼다 (`app.js`의 주석). 첫 줄은 답에 "넣을 줄"로 적어 승인 뒤 넣는다 ([app-code.md](app-code.md)) |

- 장소 하나: `{ "name", "category", "address", "note", "lat", "lng" }`. `name` · `address`는 꼭 적고 나머지는 있으면.
- **좌표는 확실할 때만** (`lat` · `lng`). 모르면 빼고 `address`만 둔다: 열 때 서버가 지도 플러그인의 키로 찾아 핀을 찍는다. 처음 찾는 주소는 방문자 한 곳에서 한 번에 30개까지라, 주소만 있는 장소가 30곳을 넘으면 넘는 곳은 목록에만 남는다 (그때는 좌표를 아는 곳의 좌표를 적는다).
- 주소는 만들기 전에 일꾼 도구 `map_geocode { addresses }`(20개씩)로 찾아지는지 본다. `found: false`는 도로명 주소로 고쳐 다시 보거나 답에 적는다. 찾은 좌표는 확인용이다: 코드 · 표에 옮겨 적지 않는다 (지도 회사 약관).
- `name`은 지도 앱에서 찾으면 그곳이 나오는 정식 이름 (지점까지). 사람의 집 · 개인 주소는 넣지 않는다.

## 바꾸는 곳, 그대로 둘 곳

- 바꾸는 곳: `places.json`, `index.html`의 제목 · 한 줄 소개 · `<title>`, `style.css`의 `:root` 토큰 값(이 앱의 `design.md`대로), 목록 한 줄에 더 보일 칸(가격 · 시간 · 사진은 `drawList` 안에서 `textContent`로).
- 더할 수 있는 것: 위 · 아래의 설명 · 출처, 상세 화면(`#<번호>` 해시나 `place/<이름>` 주소는 정적 앱이 `index.html`을 낸다), 장소 찾기 상자(`moida.map.search`, [app-code.md](app-code.md)의 "지도").
- 그대로 둘 것: 목록을 먼저 그리고 지도를 나중에 얹는 순서와 `catch`(지도 실패 → `no-map`), `mark` · `apply`의 번호 규칙, 지도 링크, 지도 위 출처 표시(가리면 러너 검사에 떨어진다), `textContent`로만 넣기(장소 글을 `innerHTML`에 넣지 않는다).
- 지도 회사의 스크립트 · 키 · `hosts`를 넣지 않는다. `moida.map`이 관리자가 고른 지도로 그린다. 미리 보기 · 기본 도메인에서는 같은 코드가 OpenStreetMap으로 그린다.

## moida.map에서 쓰는 것

- `create(자리, { places, cluster, onSelect })` → `{ select(i), update(places), pinned(), provider, map, sdk }`
- `select(i)`: `i`번 장소의 핀을 열고 `onSelect(i, 장소)`를 부른다. 핀이 없는 장소(주소를 못 찾음)면 `false`.
- `update(places)`: 지도는 두고 핀만 바꾼다. 핀이 된 수를 돌려준다. 거르기 · 찾기 뒤에 부른다 (지도를 다시 만들지 않는다).
- `pinned()`: 핀이 된 장소의 번호 목록. "몇 곳은 목록에만"을 적을 때 쓴다.
- 번호는 늘 넘긴 목록의 번호다. 주소를 못 찾아 핀이 빠져도 어긋나지 않는다.

## 본보기

`moida.json`

```json
{ "moida": 1, "render": "static", "hosts": [] }
```

`index.html`

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>성수 나들이</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top">
    <h1>성수 나들이</h1>
    <p class="lead">공원과 카페를 지도에서 보고 골라요</p>
  </header>
  <div class="tools">
    <div class="chips" id="chips" role="group" aria-label="분류"></div>
    <form class="find" id="find" role="search">
      <input id="q" type="search" placeholder="이름 · 주소로 거르기" aria-label="장소 거르기" autocomplete="off">
    </form>
  </div>
  <main class="split">
    <section class="map-box" aria-label="지도">
      <div id="map"></div>
      <p class="map-state" id="map-state" aria-live="polite">지도를 불러오는 중…</p>
    </section>
    <section class="list" aria-label="장소 목록">
      <p class="count" id="count" aria-live="polite">불러오는 중…</p>
      <ol class="places" id="places"></ol>
    </section>
  </main>
  <script src="_/moida.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

`style.css`

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff; --surface: #f2f4f3; --fg: #17191a; --muted: #5a6062; --line: #e1e4e3;
  --accent: #1f6f5c; --accent-fg: #ffffff; --danger: #c0262d;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
  --text-xs: 0.75rem; --text-sm: 0.875rem; --text-md: 1rem; --text-lg: 1.125rem;
  --text-xl: 1.25rem; --text-2xl: 1.5rem; --text-3xl: 2rem; --text-4xl: 2.5rem;
  --leading: 1.6; --leading-tight: 1.25;
  --radius: 10px; --radius-full: 999px;
  --shadow: 0 1px 2px rgb(0 0 0 / 6%), 0 4px 12px rgb(0 0 0 / 6%);
  --measure: 65ch;
  --tap: 44px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111413; --surface: #1b1f1e; --fg: #ecefee; --muted: #a2aaa8; --line: #2b3130;
          --accent: #6cc7ad; --accent-fg: #0b1a16; --danger: #ff7b72;
          --shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 4px 12px rgb(0 0 0 / 40%); }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: var(--text-md) / var(--leading) system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
}
.top { padding: var(--space-5) var(--space-4) var(--space-3); }
.top h1 { margin: 0; font-size: var(--text-2xl); line-height: var(--leading-tight); }
.lead { margin: var(--space-1) 0 0; color: var(--muted); }
.tools { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; padding: 0 var(--space-4) var(--space-3); }
.chips { display: flex; gap: var(--space-2); max-width: 100%; overflow-x: auto; }
.chips:empty { display: none; }
.chip {
  min-height: var(--tap); padding: 0 var(--space-4); border: 0; border-radius: var(--radius-full);
  background: var(--surface); color: var(--fg); font: inherit; white-space: nowrap; cursor: pointer;
}
.chip[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); }
.find { flex: 1; min-width: 12rem; margin: 0; }
.find input {
  width: 100%; min-height: var(--tap); padding: 0 var(--space-3); border: 1px solid var(--line);
  border-radius: var(--radius); background: var(--bg); color: var(--fg); font: inherit; font-size: 1rem;
}
.split { display: grid; grid-template-columns: minmax(0, 1fr); }
#map { height: 42vh; min-height: 260px; background: var(--surface); }
.map-state { margin: 0; padding: var(--space-2) var(--space-4); color: var(--muted); font-size: var(--text-sm); }
.map-state:empty { display: none; }
.list { padding: var(--space-2) var(--space-4) var(--space-7); }
.count { margin: 0 0 var(--space-2); color: var(--muted); font-size: var(--text-sm); }
.places { margin: 0; padding: 0; list-style: none; }
.place { padding: var(--space-2) var(--space-3) var(--space-3); border-bottom: 1px solid var(--line); border-radius: var(--radius); }
.place.on { background: var(--surface); }
.place-name {
  display: block; width: 100%; min-height: var(--tap); padding: 0; border: 0; background: none;
  color: inherit; font: inherit; font-size: var(--text-lg); font-weight: 600; text-align: left; cursor: pointer;
}
.place.on .place-name { color: var(--accent); }
.meta, .note { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.note { color: var(--fg); }
.links { display: flex; gap: var(--space-3); margin: var(--space-1) 0 0; font-size: var(--text-sm); }
.links a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.no-map #map { display: none; }
@media (min-width: 900px) {
  .split { grid-template-columns: minmax(0, 1fr) 400px; align-items: start; }
  .map-box { position: sticky; top: 0; }
  #map { height: calc(100dvh - var(--space-6)); }
  .no-map .split { grid-template-columns: minmax(0, 1fr); max-width: 720px; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
```

`app.js`

```js
// 지도 앱 본보기 (스킬 moida-make의 references/map-app.md). 장소는 places.json, 지도는 moida.map, 거르기는 분류 칩 · 글자.
// 목록이 먼저다: 지도를 못 그려도(지도 회사 · 키 · 네트워크) 목록과 지도 링크로 쓸 수 있다.
const state = { all: [], kind: '전체', q: '', shown: [], map: null };
const $ = (id) => document.getElementById(id);
const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;

// 장소 목록. 회원이 더하거나 관리자가 자주 바꾸는 목록이면 앱 데이터 표로 바꾼다 (map-app.md의 "데이터 둘 곳"):
//   const { rows } = await moida.from('places').select().order('name').limit(100); return rows;
async function loadPlaces() {
  const res = await fetch('places.json');
  if (!res.ok) throw new Error('장소 목록을 읽지 못했어요');
  const list = await res.json();
  return Array.isArray(list) ? list.filter((p) => p && typeof p.name === 'string') : [];
}

function kinds() {
  return ['전체', ...new Set(state.all.map((p) => p.category).filter(Boolean))];
}

function drawChips() {
  const box = $('chips');
  box.replaceChildren();
  if (kinds().length <= 2) return; // 분류가 하나면 칩을 두지 않는다
  for (const k of kinds()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = k;
    b.setAttribute('aria-pressed', String(k === state.kind));
    b.addEventListener('click', () => {
      state.kind = k;
      drawChips();
      apply();
    });
    box.append(b);
  }
}

function matches(p) {
  const q = state.q.trim().toLowerCase();
  const kindOk = state.kind === '전체' || p.category === state.kind;
  return kindOk && (!q || [p.name, p.address, p.note].some((t) => String(t || '').toLowerCase().includes(q)));
}

// 거르기가 바뀌면 목록을 다시 그리고 지도는 핀만 바꾼다 (번호 i는 state.shown의 번호, 지도도 같은 번호를 쓴다)
async function apply() {
  state.shown = state.all.filter(matches);
  drawList();
  if (state.map) mapNote(await state.map.update(state.shown));
}

function drawList() {
  const ol = $('places');
  ol.replaceChildren();
  $('count').textContent = state.shown.length > 0 ? `${state.shown.length}곳` : '맞는 장소가 없어요';
  state.shown.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'place';
    li.dataset.i = String(i);
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'place-name';
    name.textContent = p.name;
    name.addEventListener('click', () => (state.map ? state.map.select(i) : mark(i)));
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = [p.category, p.address].filter(Boolean).join(' · ');
    li.append(name, meta);
    if (p.note) {
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = p.note;
      li.append(note);
    }
    const links = document.createElement('p');
    links.className = 'links';
    for (const [label, url] of [
      ['카카오맵', `https://map.kakao.com/link/search/${encodeURIComponent(p.name)}`],
      ['네이버 지도', `https://map.naver.com/p/search/${encodeURIComponent(p.name)}`],
    ]) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = label;
      links.append(a);
    }
    li.append(links);
    ol.append(li);
  });
}

// 고른 장소를 목록에 표시한다 (목록을 눌렀을 때 · 핀을 눌렀을 때 모두 여기로 온다)
function mark(i, fromMap) {
  for (const li of $('places').children) {
    const on = Number(li.dataset.i) === i;
    li.classList.toggle('on', on);
    if (on && fromMap) li.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  }
}

function mapNote(pinned) {
  const missing = state.shown.length - pinned;
  $('map-state').textContent = missing > 0 ? `${missing}곳은 위치를 찾지 못해 목록에만 있어요` : '';
}

async function start() {
  try {
    state.all = await loadPlaces();
  } catch (error) {
    $('count').textContent = error.message;
    $('map-state').textContent = '';
    return;
  }
  drawChips();
  state.shown = state.all.filter(matches);
  drawList();
  let wait = 0;
  $('q').addEventListener('input', (e) => {
    clearTimeout(wait);
    wait = setTimeout(() => {
      state.q = e.target.value;
      apply();
    }, 250);
  });
  $('find').addEventListener('submit', (e) => e.preventDefault());
  const first = state.shown;
  try {
    state.map = await window.moida.map.create('#map', {
      places: first,
      cluster: state.all.length > 30,
      onSelect: (i) => mark(i, true),
    });
    mapNote(state.map.pinned().length);
    if (state.shown !== first) apply(); // 지도를 그리는 사이 거르기가 바뀌었으면 핀도 맞춘다
  } catch {
    document.body.classList.add('no-map');
    $('map-state').textContent = '지도를 불러오지 못했어요. 목록의 지도 링크로 보세요';
  }
}

start();
```

`places.json`

```json
[
  { "name": "서울숲", "category": "공원", "address": "서울 성동구 뚝섬로 273", "lat": 37.5444, "lng": 127.0374, "note": "넓은 잔디밭 · 반려견 동반" },
  { "name": "대림창고", "category": "카페", "address": "서울 성동구 성수이로 78", "note": "창고를 고친 큰 카페" },
  { "name": "뚝섬한강공원", "category": "공원", "address": "서울 광진구 강변북로 139", "note": "자전거 대여" },
  { "name": "어니언 성수", "category": "카페", "address": "서울 성동구 아차산로9길 8", "note": "빵이 일찍 떨어져요" }
]
```

## 확인

- `node -e "JSON.parse(require('fs').readFileSync('places.json','utf8'))"`로 `places.json`이 읽히는지, `node --check app.js`로 문법을 본다 (칸에서는 바깥 지도를 받지 못해 지도를 그려 볼 수 없다).
- 장소 수 · 분류가 지시와 같은지, 좌표를 적은 곳은 한국 범위(위도 33~39 · 경도 124~132)인지 본다.
- 답(마지막 메시지)에 좌표 없이 주소만 둔 곳, `map_geocode`로 못 찾은 주소를 적는다.
