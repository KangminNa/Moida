# 앱 라이브러리 (moida.js)

<!-- 만든 파일: apps/web/app/_blog/moida-catalog.ts에서 만든다. 직접 고치지 않는다 (apps/web에서 pnpm library) -->

앱은 `<script src="_/moida.js"></script>` 한 줄로 아래를 모두 쓴다. 빌드 없이 그대로 돈다.
타입은 같은 자리의 `_/moida.d.ts`. "주는 곳"이 플러그인이면 그 플러그인이 켜져 있을 때 일 지시의 "쓸 수 있는 라이브러리" 줄에 나온다.

## 부품 (태그 한 줄)

먼저 부품으로 짠다. 부품은 그림자 DOM 없이 그려 앱의 CSS가 그대로 먹고, 색 · 간격은 앱의 토큰(design.md의 `--accent` · `--space-*` …)을 쓴다.
부품은 `moida:ready` · `moida:select` 알림(CustomEvent)을 낸다: `el.addEventListener('moida:select', (e) => e.detail.place)`.

| 이름 | 쓰는 법 | 하는 일 | 주는 곳 |
|---|---|---|---|
| `<moida-place-list>` | `<moida-place-list src="places.json" cluster map-height="50vh"></moida-place-list>` | 장소 앱 한 벌: 분류 칩 · 거르기 · 목록 ↔ 지도 고르기 · 지도를 못 그리면 목록과 지도 링크. src 대신 table="표" | map |
| `<moida-map>` | `<moida-map src="places.json" map-height="320px"></moida-map>` | 핀만 있는 지도 (목록 · 거르기 없이) | map |
| `<moida-account>` | `<moida-account></moida-account>` | 로그인 전이면 로그인 · 가입, 로그인했으면 닉네임과 로그아웃. 격리된 화면에서는 안내 한 줄 | 기본 |
| `<moida-rows>` | `<moida-rows table="guestbook" order="created_at desc" limit="20"><template><p data-field="body"></p></template></moida-rows>` | 앱 데이터 표의 줄마다 template을 복사해 data-field 칸에 값을 글자로 넣는다. mine이면 내 줄만, 다시 읽기는 요소.reload() | 기본 |

## moida (스크립트)

부품으로 안 되는 것만 직접 부른다. 실패하면 Error를 던진다 (status · code가 붙는다).

| 이름 | 쓰는 법 | 하는 일 | 주는 곳 |
|---|---|---|---|
| `moida.open` | `if (!moida.open) …` | 회원 · 데이터를 쓸 수 있는 화면인가 (앱의 도메인으로 연 공개 화면). 거짓이면 안내를 그린다 | 기본 |
| `moida.page` | `moida.page` | 이 화면 주소의 데이터 (화면에 실려 온 moida-data 블록, 없으면 null) | 기본 |
| `moida.data` | `await moida.data('posts/<글>')` | 그 주소의 데이터 ('' 첫 화면 · 'posts/<글>' · 'm/<메뉴>' · 'm/<메뉴>/<번호>'). 다른 공개 앱의 글이면 { redirect } | 기본 |
| `moida.me` | `const { member } = await moida.me()` | 로그인한 회원 (없으면 member가 null) | 기본 |
| `moida.login` | `moida.login() · moida.join() · await moida.logout()` | 가입 · 로그인은 Moida의 고정 화면이 한다 (비밀번호는 앱 코드를 거치지 않는다). 끝나면 지금 주소로 돌아온다 | 기본 |
| `moida.from` | `await moida.from('표').select().eq('칸', 값).order('칸', 'desc').limit(10)` | moida.json에 선언한 앱 데이터 표 읽기 → { rows, more }. 조건 eq neq gt gte lt lte, 내 줄만 .mine(). 쓰기 insert · update(id) · delete(id) | 기본 |
| `moida.community` | `await moida.community.write({ title, body })` | 커뮤니티 글 · 댓글 · 신고: topics(cursor?) · topic(id) · write · edit · remove · comment · removeComment · report | 기본 |
| `moida.map` | `const map = await moida.map.create('#map', { places, cluster: true, onSelect })` | 지도 그리기 → { select(i), update(places), pinned() }. 찾기 search · geocode · reverse. 플러그인 map이 꺼져 있어도 OpenStreetMap으로 그린다 | map |

## 장소 하나

`{ name, address?, category?, note?, lat?, lng? }`. 좌표가 없으면 주소로 찾는다 (찾기를 켜지 않았거나 못 찾으면 목록에만).
