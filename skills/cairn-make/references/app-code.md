# 앱 코드 (스토어의 앱 화면)

블로그 · 매거진 · 페이지 · 커뮤니티 앱은 앱마다 자기 코드(HTML 템플릿 · CSS · JS · 그림)로 그려진다.
웹이 방문자가 연 화면마다 템플릿을 골라 **Mustache**로 데이터를 채운다. 코드는 서버에서 실행되지 않는다.
지시문의 `# 고칠 앱` 단락에 지금 코드(가장 새 버전, 없으면 앱 종류의 시작 코드)가 적힌 폴더가 있다.

## 파일과 화면

| 화면 | 주소 | 템플릿 (없으면 `index.html`) |
|---|---|---|
| 첫 화면 | `/<앱>` | `index.html` |
| 글 하나 | `/<앱>/posts/<글>` | `post.html` |
| 메뉴 (글 목록 · 호 목록 · 페이지 목록 · 페이지) | `/<앱>/m/<메뉴>` | `list.html` |
| 매거진의 호 하나 | `/<앱>/m/<메뉴>/<번호>` | `issue.html` |
| 커뮤니티의 글 하나 | `/<앱>/t/<글 id>` | `topic.html` |
| 페이지 앱의 다른 화면 | `/<앱>/<이름>` (영문 소문자 · 숫자 · `-`, `index` · `404` 빼고) | `<이름>.html` (없으면 404) |
| 앱 안의 없는 주소 | | `404.html` (없으면 Moida의 404) |

- `index.html`은 꼭 있어야 한다. 다른 템플릿은 없어도 된다.
- 화면의 디자인은 [design.md](design.md)의 기준(스타일 · 토큰 · 체크리스트), 글 · 지어내지 않기 규칙은 [page.md](page.md)의 "모양"과 같다. 러너가 "디자인 기준" 검사로 본다.
- 조각: `{{> header}}`는 같은 묶음의 `header.html`을 그 자리에 넣는다. 블로그 · 매거진 · 커뮤니티의 시작 코드는 `head` · `header` · `footer` · `post-list` · `page-list` · `issue-body`를 조각으로 쓴다.

### 페이지 앱 (블로그 틀 없음, 2026-11-20)

- 시작 코드는 빈 화면 한 장(`index.html` · `style.css` · `icon.svg`)이다. 블로그의 머리 · 메뉴 · 꼬리 · 글 목록 조각이 없고, 그 모양을 따라 하지 않는다.
- 이 앱이 하는 일(누가 · 무엇을 · 어떤 느낌)에 맞게 설계한다: 도구(일정표 · 계산기 · 지도)는 바로 쓰는 화면, 소개 · 포트폴리오는 읽는 흐름, 대시보드는 숫자가 먼저. **모양은 이 앱의 디자인 문서(`design.md`)대로** 만든다: 없으면 [design-research.md](design-research.md)대로 같은 분야의 잘 만든 화면을 찾아 보고 먼저 쓴다. 지시에 분위기 · 색 · 참고 사이트가 있으면 그것이 먼저다. 토큰 이름은 [design.md](design.md) 그대로.
- 흔한 템플릿 모양을 피한다: 가운데 정렬 큰 제목 + 똑같은 카드 3개 + "Learn more" · "Get started" 같은 버튼 말 + 기본 그라디언트. 실제 내용 · 실제 기능이 첫 화면에 보이게 한다.
- 화면이 여럿이면 `<이름>.html`로 나누고 `{{base}}/<이름>`으로 잇는다 (데이터의 `isView` · `view`가 지금 화면의 이름). 한 화면 안에서 스크립트로 바꿔도 된다.
- 앱 코드를 만든 적이 없는 페이지 앱에 공개 페이지가 있으면 그 페이지가 화면이다. 앱 코드를 공개하면 코드가 화면이 되고, 페이지는 `pages`의 `url`로 링크한다.
- 페이지 없이 만든 페이지 앱은 `pages`가 빈 목록이고 화면은 이 코드가 전부다 (스토어 2-6).
- 파일은 폴더 없이 나란히 100개까지, 합쳐 20MB, 템플릿(.html)은 합쳐 1MB. 이름에 `/`를 넣지 않고 점으로 시작하지 않는다 (폴더는 아래 "정적 앱"에서만).
- 같은 묶음의 파일은 `{{files}}/style.css`처럼 연다. 앱의 첫 화면 링크는 `{{base}}`다 (미리 보기 주소에는 토큰이 들어 있어서 `/<앱>`을 직접 쓰면 미리 보기를 벗어난다).
- 앱 안의 링크는 같은 탭, 다른 사이트로 가는 링크는 `target="_blank" rel="noopener noreferrer"`로 새 탭에 연다. 글 본문(`post.html`)의 바깥 링크는 웹이 이미 그렇게 그린다.

### 정적 앱 (템플릿 없음, 페이지 · 커뮤니티 앱에서, 2026-11-21)

`cairn.json`에 `"render": "static"`을 넣으면 웹이 템플릿을 채우지 않고 **묶음의 파일을 그대로** 내보낸다. 스크립트가 화면을 그리는 앱(도구 · 지도 · 대시보드), 프레임워크로 빌드한 결과(`dist/`)는 이쪽으로 만든다.

```json
{ "cairn": 1, "render": "static", "hosts": [] }
```

- 주소가 곧 파일이다: `/<앱>/` → `index.html`, `/<앱>/about` → `about/index.html` (`about.html`은 `/<앱>/about.html`로 연다), `/<앱>/assets/app.js` → `assets/app.js`. 확장자 없는 없는 주소(`/<앱>/places/3`)는 `index.html`을 낸다: 앱 안의 화면 전환(history · hash 라우터)을 스크립트가 맡을 수 있다. 확장자가 있는 없는 파일은 404.
- `.html`에 Mustache를 쓰지 않는다 (`{{ }}`는 글자 그대로 나간다). 문법 · 데이터 이름 검사도 없다.
- 폴더를 쓸 수 있다: 파일 500개 · 합쳐 20MB · HTML 하나 1MB · 경로는 파일까지 여섯 마디 · 300자. 점으로 시작하는 이름은 쓸 수 없다.
- **주소는 모두 상대 주소로 쓴다** (`assets/app.js` · `./about/` · `../`). 웹이 HTML마다 `<base>`를 넣어 그 파일이 있는 폴더를 기준으로 풀리게 한다. `/`로 시작하는 주소는 앱 밖(사이트의 뿌리)을 가리켜 깨진다: 미리 보기 주소에는 토큰이 들어 있고, 앱 주소는 `/<앱>` 아래다. 빌드 도구를 쓰면 기준 주소를 상대로 둔다 (Vite는 `base: './'`). `<base>`를 직접 넣지 않는다.
- 데이터는 템플릿 앱과 같은 블록 하나로 **그 주소의 것**이 온다: `cairn.page`(`<script src="_/cairn.js">`를 실으면) 또는 `JSON.parse(document.getElementById('cairn-data').textContent)`. 첫 화면은 `screen: 'home'`, 글 주소(`posts/<글>`)는 `post`(본문은 거른 `post.html`), 메뉴(`m/<메뉴>`) · 호(`m/<메뉴>/<번호>`)는 `menu` · `issue`, 앱 JS가 맡는 깊은 주소는 `missing`이다. `{{base}}` · `{{files}}`는 없고 앱 주소 앞부분은 `base`다.
- 화면을 바꾸지 않고 다른 주소의 데이터가 필요하면 `await cairn.data('posts/<글>')` · `cairn.data('m/<메뉴>', 다음 쪽 커서)` · `cairn.data('')`(첫 화면). 글 · 메뉴 · 호는 템플릿 없이 이것으로 그린다. 다른 공개 앱의 글이면 `{ redirect }`만 온다. 방문자 데이터라 초안은 없고, 미리 보기 · 기본 도메인에서도 된다.
- 스크립트를 돌리지 않는 검색 로봇을 위해 웹이 그 주소의 제목 · 본문 · 글 링크를 `<noscript>`로 더한다. 앱이 따로 할 것은 없다.
- 같은 묶음의 파일은 `fetch('data.json')`으로 읽을 수 있다 (모듈 스크립트 · 글꼴도 된다). 바깥 호스트는 `hosts`에 적은 것만 열린다. 쿠키 · `localStorage` · 서비스 워커 · 회원 · 데이터는 그 앱의 도메인으로 연 공개 화면에서만 된다 (아래 "회원 · 데이터 · 권한").
- **내는 법**: 폴더가 없으면 파일을 결과물 폴더에 그대로 둔다 (앞 코드 위에 얹힌다). 폴더가 있으면 묶음 전체를 `app.zip` 하나로 낸다: `python3 -c "import shutil; shutil.make_archive('<결과물 폴더>/app', 'zip', 'dist')"`. zip 안이 새 버전의 전부다: zip에 없는 글 파일은 사라지고, 지시문에 "그대로 남아요"라고 적힌 파일(내용 없이 이름만 받은 그림 · 큰 파일)은 zip에 없어도 남는다. `app.zip`과 함께 둔 다른 파일은 묶음에 들지 않는다.
- zip 안에 `cairn.json`(`"render": "static"`)과 `index.html`이 꼭 있어야 한다. 어느 종류의 앱이든 정적 앱이 된다: 블로그 · 매거진 앱은 글 · 메뉴 · 호 주소의 데이터(`cairn.page`, 다른 주소는 `cairn.data`)로 화면을 그린다. 커뮤니티 앱을 정적 앱으로 만들면 글 목록 · 글 · 쓰기 화면을 `cairn.community`로 직접 그린다.
- 빌드에 패키지가 필요하면 샌드박스에서 받을 수 있는지 먼저 본다. 받을 수 없으면 빌드 없이 손으로 쓴 HTML · CSS · JS(모듈)로 만든다.

## 문법 (로직 없는 Mustache)

- `{{post.title}}`: 글자를 넣는다 (`<` 같은 문자는 바꿔 넣어 안전하다).
- `{{{post.html}}}`: HTML을 그대로 넣는다. **`post.html`에만** 쓴다 (글 본문을 웹이 그려 거른 것). 다른 값에 쓰면 검사에 떨어진다.
- `{{#posts}}…{{/posts}}`: 목록이면 항목마다 되풀이하고, 값이면 있을 때만 그린다. 안에서는 항목의 칸을 이름만으로 쓴다 (`{{title}}` · `{{url}}`).
- `{{^posts}}…{{/posts}}`: 없을 때만 (빈 목록 · null · false).
- `{{#others.length}}…{{/others.length}}`: 목록이 비지 않았을 때 한 번만.
- `{{.}}`: 글자 목록의 항목 (`{{#post.tags}}#{{.}}{{/post.tags}}`).
- `{{! 설명 }}`은 그려지지 않는다. 구분자 바꾸기(`{{= =}}`)는 쓰지 않는다. 계산 · 함수는 없다: 필요한 값은 아래 데이터에 있는 것만 쓴다.

## 데이터 (약속 cairn: 1)

| 이름 | 있는 화면 | 내용 |
|---|---|---|
| `screen` · `isHome` · `isPost` · `isMenu` · `isIssue` · `isView` | 모두 | 화면 종류 (home · post · menu · issue · topic · view · missing)와 그 표시 |
| `view` | 페이지 앱의 다른 화면 | 주소의 이름 (`/<앱>/<이름>`). 그 밖은 null |
| `title` | 모두 | 이 화면의 제목 (`<title>`에) |
| `base` · `files` | 모두 | 앱 첫 화면 주소 · 이 묶음의 파일 주소 앞부분 |
| `site` | 모두 | `{ name, home, store, loginUrl, graphUrl }` (`graphUrl`은 공개 글이 없으면 null. "모든 앱" 링크는 `store`: 첫 화면이 앱 하나로 고정돼도 늘 앱 목록) |
| `app` | 모두 | `{ name, description, kind, url, iconUrl, rssUrl }` (`iconUrl`이 없으면 `{{files}}/icon.svg`. `head`에 탭 아이콘 `<link rel="icon">`으로 둔다) |
| `apps` · `others` | 모두 | 공개 앱 `[{ name, url, iconUrl, current }]`, `others`는 이 앱을 뺀 것 |
| `menus` | 모두 | `[{ name, url, kind, active }]` |
| `menu` | 메뉴 · 호 · 매거진 첫 화면 | `{ name, url, kind, isPosts, isIssues, isPages, isPage, rssUrl }` |
| `posts` · `more` | 첫 화면 · 메뉴 | `[{ title, excerpt, url, date, dateText, tags }]` 20개씩 · 다음 쪽 `{ url }` 또는 null |
| `post` | 글 | `{ title, excerpt, url, date, dateText, tags, html, center, listed, back }` (`listed`가 거짓이면 링크 공개 글: noindex, `back`은 돌아갈 목록) |
| `issues` | 매거진 첫 화면 · 호 메뉴 | `[{ number, title, intro, url, date, dateText }]` |
| `issue` | 호 · 매거진 첫 화면(최신 호) | `{ number, title, intro, url, date, dateText, posts: [{ title, excerpt, url }] }` |
| `pages` | 페이지 앱 첫 화면 · 페이지 메뉴 | `[{ title, url, date, dateText }]` |
| `isTopic` · `topic` | 커뮤니티 글 하나 | `{ title, html, url, date, dateText, edited, author: { nickname }, mine, editUrl, commentUrl, reportUrl, comments: [{ body, date, dateText, author: { nickname }, mine, reportUrl }] }` (`html`은 회원 글을 거른 HTML이라 `{{{ }}}`, 댓글 `body`는 글자라 `{{ }}`. `editUrl`은 내 글일 때만, 내 것에는 `reportUrl`이 없다) |
| `topics` · `more` | 커뮤니티 첫 화면 | `[{ title, excerpt, url, date, dateText, author: { nickname }, comments }]` 30개씩 · 다음 쪽 `{ url }` 또는 null |
| `community` | 커뮤니티 모든 화면 | `{ open, member: { nickname } \| null, joinUrl, loginUrl, meUrl, writeUrl }`. 회원 화면(가입 · 로그인 · 글쓰기 · 댓글 · 신고 · 내 정보)은 Moida가 그리는 고정 화면이고 템플릿은 이 주소로 링크만 건다. 앱 도메인이 아니면(미리 보기) `open`이 거짓이고 주소는 null |

- `date`는 ISO 시각, `dateText`는 웹이 만든 한국어 날짜 (`2026년 11월 18일`).
- 없는 이름은 빈 칸으로 그려진다. 러너의 검사가 약속에 없는 이름을 알려 준다.
- 커뮤니티의 글 · 댓글은 회원이 쓴 글이다: 템플릿에서 링크로 바꾸지 않는다. 쓰기는 `community`의 고정 화면 주소로 링크하거나, 앱 도메인의 화면에서 `cairn.community`로 직접 보낸다 (아래 "회원 · 데이터 · 권한").

## 스크립트

- 같은 데이터가 `<script id="cairn-data" type="application/json">`으로 페이지에 실린다: `JSON.parse(document.getElementById('cairn-data').textContent)` (cairn.js를 실으면 `cairn.page`). 다른 주소의 데이터는 `cairn.data(주소, 커서?)`.
- 화면이 열리는 곳은 둘이다.
  - **그 앱의 도메인으로 연 공개 화면**: 보통 웹 페이지처럼 열린다. 쿠키 · `localStorage` · IndexedDB · 서비스 워커를 쓰고, 회원 · 데이터(`cairn.js`)가 돈다.
  - **미리 보기 · 기본 도메인의 `/<앱>`**: 격리되어 열린다 (출처 없는 문서). 쿠키 · 저장소 · 회원 · 데이터를 쓸 수 없다. 관리자가 공개 전에 보는 화면이 이쪽이라, 로그인 없이도 첫 화면이 그려지게 만든다 (`cairn.open`이 거짓이면 안내를 보인다).
- 바깥으로의 요청(`fetch` · 글꼴 · 스크립트 · 폼)은 `cairn.json`의 `hosts`에 적은 호스트만 열린다. 그림은 https 어디서나 된다.

## cairn.json (앱의 선언서)

앱이 Moida에게 바라는 것을 적는 한 장이다. 없으면 템플릿 앱이고 바깥 주소 · 회원 · 표가 없다.

```json
{
  "cairn": 1,
  "render": "static",
  "hosts": ["fonts.example.com"],
  "members": true,
  "permissions": ["microphone"],
  "theme": { "accent": "#58cc02", "background": "#ffffff", "text": "#1f2937", "logo": "logo.svg" },
  "tables": {
    "progress": { "columns": { "lesson": "text", "xp": "int", "done": "bool" }, "read": "owner", "write": "owner" },
    "scores": { "columns": { "nickname": "text", "xp": "int" }, "read": "anyone", "write": "owner" },
    "lessons": { "columns": { "title": "text", "body": "json" }, "read": "anyone", "write": "admin" }
  }
}
```

- `hosts`는 정확한 호스트 이름만 10개까지 (와일드카드 · IP · 포트 없이). 지시가 바깥 서비스(글꼴 · 댓글)를 요구할 때만 더한다. 지도는 `hosts`에 적지 않고 `cairn.map`을 쓴다 (아래 "지도": 지도 회사의 주소는 Moida가 열어 준다).
- `members`: 가입 · 로그인을 받는다 (커뮤니티 앱은 적지 않아도 늘 받는다).
- `permissions`: 브라우저 권한. `microphone` · `camera` · `geolocation` 가운데 쓰는 것만. 적지 않은 권한은 막힌다.
- `theme`: Moida가 그리는 가입 · 로그인 화면에 입힐 색(`#rrggbb`)과 로고(묶음 바로 아래의 파일 이름).
- `tables`: 이 앱의 데이터. 아래 "회원 · 데이터 · 권한".
- 틀린 선언서는 러너의 묶음 검사에 떨어진다.

## 회원 · 데이터 · 권한 (cairn.js, 그 앱의 도메인에서만)

앱 코드는 서버 코드 · SQL을 갖지 않는다. 표는 `cairn.json`에 선언하고, 화면에서는 `cairn.js`로 읽고 쓴다.

```html
<script src="_/cairn.js"></script>
```

- 주소는 상대로 쓴다: 묶음 맨 위의 HTML에서는 `_/cairn.js`, `about/index.html`처럼 폴더 안이면 `../_/cairn.js`. 템플릿 앱에서는 `{{base}}/_/cairn.js`.
- `cairn.open`: 이 화면에서 회원 · 데이터를 쓸 수 있는가 (그 앱의 도메인으로 연 공개 화면). 거짓이면 아래 호출은 실패한다 (`code: 'closed'`).

| 부르는 것 | 하는 일 |
|---|---|
| `await cairn.me()` | `{ member: { nickname } \| null }` |
| `cairn.login(돌아올 곳?)` · `cairn.join(돌아올 곳?)` | Moida의 로그인 · 가입 화면으로 간다. 끝나면 돌아온다 |
| `await cairn.logout()` | 로그아웃 |
| `await cairn.from('scores').select().order('xp', 'desc').limit(10)` | `{ rows, more }`. 조건: `.eq` · `.neq` · `.gt` · `.gte` · `.lt` · `.lte`(칸, 값), 내 줄만: `.mine()`, 다음 쪽: `.offset(n)` (한 번에 100줄까지) |
| `await cairn.from('progress').insert({ lesson: 'a1', xp: 10 })` | 줄 하나를 넣고 그 줄을 돌려준다 |
| `await cairn.from('progress').update(id, { xp: 20 })` · `.delete(id)` | 줄 하나를 고친다 · 지운다 |

- 줄마다 Moida가 붙이는 칸: `id` · `owner`(넣은 회원) · `created_at` · `updated_at`. 이 이름은 선언하지 않는다.
- 칸의 타입: `text`(1만 자) · `int` · `number` · `bool` · `time`(ISO 시각) · `json`(16KB). 표 20개 · 표마다 칸 30개까지. 이름은 영문 소문자로 시작하는 소문자 · 숫자 · `_`.
- 읽기 규칙 `read`: `anyone`(누구나) · `member`(로그인한 회원) · `owner`(넣은 회원 자신) · `admin`(콘솔에서만).
- 쓰기 규칙 `write`: `member`(회원이면 넣고, 고치기 · 지우기는 자기 줄만) · `owner`(같다: 자기 줄만) · `admin`(화면에서는 못 쓴다. 관리자가 콘솔에서, 일꾼이 승인받아 넣는다).
- 규칙은 서버(DB의 줄 단위 규칙)가 지킨다. 화면에서 감추는 것으로 대신하지 않는다. 순위표처럼 모두가 보는 값은 따로 `read: "anyone"` 표에 둔다 (`owner` 표는 남이 읽지 못한다).
- 표와 칸은 더하기만 한다. 칸의 타입은 바꿀 수 없다 (새 이름으로 더한다). 선언에서 뺀 표 · 칸의 데이터는 지워지지 않고 남는다.
- 회원 한 명이 표 하나에 넣는 줄은 1,000개까지, 표 하나는 10만 줄까지다. 자주 바뀌는 값은 줄을 새로 넣지 않고 `update`로 고친다.
- 비밀번호 · 가입 폼은 앱 코드에 두지 않는다: `cairn.login()` · `cairn.join()`이 Moida의 화면으로 보낸다 (원칙 8).
- 읽기 규칙에 맞지 않는 줄은 오류 없이 빠져서 온다 (로그인하지 않은 방문자가 `member` · `owner` 표를 읽으면 빈 목록). 쓰기가 실패하면 `Error`를 던진다 (`status` · `code` · `message`): 401은 로그인이 필요하다는 뜻이고, 남의 줄을 고치려 하면 없는 줄(404)이다.
- 커뮤니티 앱: `cairn.community.topics(cursor?)` · `topic(id)` · `write({ title, body })` · `edit(id, { version, title, body })` · `remove(id, version)` · `comment(topicId, body)` · `removeComment(id, version)` · `report({ topicId | commentId, reason, note? })`. 글 · 댓글은 회원이 쓴 글자다: `textContent`로 넣고 `innerHTML`에 그대로 넣지 않는다 (`topic.html`만 서버가 거른 HTML이다).
- 처음 채울 내용(레슨 · 단어 목록 같은 `write: "admin"` 표의 줄)은 앱 코드에 넣지 않는다. 답에 "넣을 줄"을 적으면 대표가 승인을 받아 넣는다. 바뀌지 않는 작은 내용은 묶음의 `data.json`에 두어도 된다.

## 지도 (cairn.map, 지도 플러그인)

장소가 나오는 앱(맛집 · 코스 · 매장 · 여행)은 `cairn.map`으로 지도를 그린다. **장소가 중심인 앱은 [map-app.md](map-app.md)의 본보기에서 시작한다** (화면 구성 · 데이터 둘 곳 · 거르기 · 지도 실패가 정해져 있다). 아래는 약속만이다. 어느 회사 지도인지(OpenStreetMap · 카카오 · 네이버 · 구글)는 관리자가 지도 플러그인에서 정하고, 앱 코드는 모른다. 지도 회사의 스크립트 · 키를 앱 코드에 직접 넣지 않는다.

```html
<div id="map" style="height:360px"></div>
<ol id="places"></ol>
<script src="_/cairn.js"></script>
<script>
  const PLACES = [{ lat: 37.5665, lng: 126.978, name: '서울시청' }];
  // 목록은 지도와 상관없이 먼저 그린다 (지도를 받지 못해도 읽히게)
  for (const p of PLACES) document.getElementById('places').append(Object.assign(document.createElement('li'), { textContent: p.name }));
  cairn.map.create('#map', { places: PLACES, onSelect: (i, p) => console.log(p.name) })
    .catch(() => document.getElementById('map').remove());
</script>
```

- `cairn.map.create(자리, { places, zoom?, cluster?, onSelect? })` → `{ provider, map, sdk, select(i), update(places), pinned() }`. 자리에는 높이를 준다. 좌표가 있는(또는 주소를 찾은) 장소만 핀이 되고, 핀을 누르면 이름이 뜨고 `onSelect(i, place)`가 불린다. 목록에서 `select(i)`로 그 핀을 연다 (핀이 없는 장소면 `false`). **번호 `i`는 늘 넘긴 `places`의 번호다** (주소를 못 찾아 핀이 빠져도 어긋나지 않는다).
- 거르기 · 찾기로 보일 장소가 바뀌면 `update(places)`로 핀만 바꾼다 (핀이 된 수를 돌려준다). 지도를 지우고 `create`를 다시 부르지 않는다. 핀이 된 장소의 번호는 `pinned()`.
- 장소가 수십 곳 넘게 몰리면 `cluster: true`로 가까운 핀을 숫자 하나로 묶는다 (OpenStreetMap · 카카오 · 구글. 네이버는 묶지 않고 그대로 그린다). 묶기 라이브러리를 받지 못해도 핀은 그린다.
- 지도 위의 출처 · 로고(`.leaflet-control-attribution`, 회사 로고)는 지도 회사 약관상 숨기지 않는다: `display:none` · `visibility:hidden` · `opacity:0`으로 가리면 러너 검사가 거절한다.
- 카카오 · 네이버 · 구글 지도는 그 앱의 도메인으로 연 화면에서만 돈다 (회사 콘솔에 그 도메인을 등록한 키). 미리 보기 · 기본 도메인처럼 격리된 화면에서는 같은 코드가 OpenStreetMap으로 그린다. 고른 회사의 지도를 받지 못해도 OpenStreetMap으로 그리고, 그것도 못 받으면 Error를 던진다: 목록이 남게 한다.
- 좌표를 모르면 지어내지 않고 주소를 넘긴다: `places: [{ address: '서울 중구 세종대로 110', name: '서울시청' }]`. 서버가 지도 플러그인의 서버 키로 좌표를 찾아 핀을 찍는다 (찾기를 켜지 않았거나 못 찾은 주소는 빠지고, 목록은 남긴다).
- 검색 상자 · "내 주변"은 `cairn.map.search(q, { near?: { lat, lng }, size? })` → `{ places: [{ name, address, lat, lng, id }], provider, attribution }`, 주소 → 좌표는 `cairn.map.geocode(address)`, 좌표 → 주소는 `cairn.map.reverse(lat, lng)`. 결과 옆에 `attribution`(찾은 회사)을 작게 적는다. 찾기를 켜지 않았으면 Error(`status` 404)라 검색 상자를 숨긴다. 방문자 한 곳에서 분당 30번까지라 글자마다 부르지 않고 입력을 마치면(엔터 · 0.4초 멈춤) 부른다.
- 장소 주소를 지시나 자료에서 받았으면 만들기 전에 일꾼 도구 `map_geocode { addresses }`(한 번에 20개)로 찾아지는지 본다. `found: false`인 주소는 도로명 주소로 고쳐 다시 보거나 답에 적는다. 찾은 좌표는 확인용이다: 코드에는 주소를 넣는다. 찾기를 켜지 않았다는 거절이면 그대로 주소만 넘긴다.
- 찾은 좌표를 앱 데이터(`cairn.from`)에 오래 저장하지 않는다 (회사 약관이 저장 기간을 정한다): 주소를 저장하고 화면을 열 때 찾는다.
- 더 꾸미려면 `map` · `sdk`(그 회사 라이브러리)를 쓸 수 있지만, 회사가 바뀌면 그 코드는 돌지 않는다: `provider`를 보고 나눈다.

## 고치는 법

1. `# 고칠 앱`의 폴더에서 지금 코드를 읽는다. 블로그 · 매거진 · 커뮤니티의 시작 코드면 `style.css`의 색 토큰(`--bg` · `--fg` · `--accent` …)과 어두운 화면 규칙이 있다: 색은 토큰을 바꿔 고친다. 페이지 앱은 시작 코드를 바탕으로 삼지 않고 위의 "페이지 앱" 대로 새로 만든다.
2. 지시에 맞게 바꾼 파일만 결과물 폴더에 둔다. 같은 이름의 파일은 통째로 바뀌므로 고친 전체를 낸다. 지우고 싶은 파일은 지울 수 없다: 쓰지 않게 바꾼다.
3. 폰에서 먼저 본다: 한 줄로 읽히게 쌓고 넓은 화면에서만 나란히 놓는다. 이미지에는 `alt`, 링크에는 알아볼 글자를 둔다.
4. 다시 읽어 확인한다: 여닫는 짝(`{{#…}}` · `{{/…}}`), 조각 이름(`{{> 이름}}`에 맞는 `이름.html`), `{{{ }}}`는 `post.html`에만, 링크는 `{{base}}` · `{{url}}`에서.
5. 답에는 바꾼 파일과 바꾼 까닭, 지시와 다르게 한 것을 적는다.
