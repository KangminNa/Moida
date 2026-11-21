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
| 앱 안의 없는 주소 | | `404.html` (없으면 Cairn의 404) |

- `index.html`은 꼭 있어야 한다. 다른 템플릿은 없어도 된다.
- 조각: `{{> header}}`는 같은 묶음의 `header.html`을 그 자리에 넣는다. 블로그 · 매거진 · 커뮤니티의 시작 코드는 `head` · `header` · `footer` · `post-list` · `page-list` · `issue-body`를 조각으로 쓴다.

### 페이지 앱 (블로그 틀 없음, 2026-11-20)

- 시작 코드는 빈 화면 한 장(`index.html` · `style.css` · `icon.svg`)이다. 블로그의 머리 · 메뉴 · 꼬리 · 글 목록 조각이 없고, 그 모양을 따라 하지 않는다.
- 이 앱이 하는 일(누가 · 무엇을 · 어떤 느낌)에 맞게 처음부터 설계한다: 도구(일정표 · 계산기 · 지도)는 바로 쓰는 화면, 소개 · 포트폴리오는 읽는 흐름, 대시보드는 숫자가 먼저. 색 · 글꼴 · 배치도 앱마다 새로 정한다.
- 흔한 템플릿 모양을 피한다: 가운데 정렬 큰 제목 + 똑같은 카드 3개 + "Learn more" · "Get started" 같은 버튼 말 + 기본 그라디언트. 실제 내용 · 실제 기능이 첫 화면에 보이게 한다.
- 화면이 여럿이면 `<이름>.html`로 나누고 `{{base}}/<이름>`으로 잇는다 (데이터의 `isView` · `view`가 지금 화면의 이름). 한 화면 안에서 스크립트로 바꿔도 된다.
- 앱 코드를 만든 적이 없는 페이지 앱에 공개 페이지가 있으면 그 페이지가 화면이다. 앱 코드를 공개하면 코드가 화면이 되고, 페이지는 `pages`의 `url`로 링크한다.
- 페이지 없이 만든 페이지 앱은 `pages`가 빈 목록이고 화면은 이 코드가 전부다 (스토어 2-6).
- 파일은 폴더 없이 나란히 100개까지, 합쳐 20MB, 템플릿(.html)은 합쳐 1MB. 이름에 `/`를 넣지 않고 점으로 시작하지 않는다 (폴더는 아래 "정적 앱"에서만).
- 같은 묶음의 파일은 `{{files}}/style.css`처럼 연다. 앱의 첫 화면 링크는 `{{base}}`다 (미리 보기 주소에는 토큰이 들어 있어서 `/<앱>`을 직접 쓰면 미리 보기를 벗어난다).
- 앱 안의 링크는 같은 탭, 다른 사이트로 가는 링크는 `target="_blank" rel="noopener noreferrer"`로 새 탭에 연다. 글 본문(`post.html`)의 바깥 링크는 웹이 이미 그렇게 그린다.

### 정적 앱 (템플릿 없음, 페이지 앱에서만, 2026-11-21)

`cairn.json`에 `"render": "static"`을 넣으면 웹이 템플릿을 채우지 않고 **묶음의 파일을 그대로** 내보낸다. 스크립트가 화면을 그리는 앱(도구 · 지도 · 대시보드), 프레임워크로 빌드한 결과(`dist/`)는 이쪽으로 만든다.

```json
{ "cairn": 1, "render": "static", "hosts": [] }
```

- 주소가 곧 파일이다: `/<앱>/` → `index.html`, `/<앱>/about` → `about/index.html` (`about.html`은 `/<앱>/about.html`로 연다), `/<앱>/assets/app.js` → `assets/app.js`. 확장자 없는 없는 주소(`/<앱>/places/3`)는 `index.html`을 낸다: 앱 안의 화면 전환(history · hash 라우터)을 스크립트가 맡을 수 있다. 확장자가 있는 없는 파일은 404.
- `.html`에 Mustache를 쓰지 않는다 (`{{ }}`는 글자 그대로 나간다). 문법 · 데이터 이름 검사도 없다.
- 폴더를 쓸 수 있다: 파일 500개 · 합쳐 20MB · HTML 하나 1MB · 경로는 파일까지 여섯 마디 · 300자. 점으로 시작하는 이름은 쓸 수 없다.
- **주소는 모두 상대 주소로 쓴다** (`assets/app.js` · `./about/` · `../`). 웹이 HTML마다 `<base>`를 넣어 그 파일이 있는 폴더를 기준으로 풀리게 한다. `/`로 시작하는 주소는 앱 밖(사이트의 뿌리)을 가리켜 깨진다: 미리 보기 주소에는 토큰이 들어 있고, 앱 주소는 `/<앱>` 아래다. 빌드 도구를 쓰면 기준 주소를 상대로 둔다 (Vite는 `base: './'`). `<base>`를 직접 넣지 않는다.
- 데이터는 템플릿 앱과 같은 블록 하나로 온다: `JSON.parse(document.getElementById('cairn-data').textContent)` (첫 화면의 데이터: `app` · `site` · `apps` · `menus` · `pages` · `base`). `{{base}}` · `{{files}}`는 없다.
- 같은 묶음의 파일은 `fetch('data.json')`으로 읽을 수 있다 (모듈 스크립트 · 글꼴도 된다). 이 서버의 API · 쿠키 · `localStorage`는 템플릿 앱과 같이 쓸 수 없고, 바깥 호스트는 `hosts`에 적은 것만 열린다. 워커 · 서비스 워커 · 위치 정보도 쓸 수 없다.
- **내는 법**: 폴더가 없으면 파일을 결과물 폴더에 그대로 둔다 (앞 코드 위에 얹힌다). 폴더가 있으면 묶음 전체를 `app.zip` 하나로 낸다: `python3 -c "import shutil; shutil.make_archive('<결과물 폴더>/app', 'zip', 'dist')"`. zip 안이 새 버전의 전부다: zip에 없는 글 파일은 사라지고, 지시문에 "그대로 남아요"라고 적힌 파일(내용 없이 이름만 받은 그림 · 큰 파일)은 zip에 없어도 남는다. `app.zip`과 함께 둔 다른 파일은 묶음에 들지 않는다.
- zip 안에 `cairn.json`(`"render": "static"`)과 `index.html`이 꼭 있어야 한다. 블로그 · 매거진 · 커뮤니티 앱은 정적 앱이 될 수 없다 (글 · 메뉴 화면이 템플릿이다).
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
| `site` | 모두 | `{ name, home, loginUrl, graphUrl }` (`graphUrl`은 공개 글이 없으면 null) |
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
| `community` | 커뮤니티 모든 화면 | `{ open, member: { nickname } \| null, joinUrl, loginUrl, meUrl, writeUrl }`. 회원 화면(가입 · 로그인 · 글쓰기 · 댓글 · 신고 · 내 정보)은 Cairn이 그리는 고정 화면이고 템플릿은 이 주소로 링크만 건다. 앱 도메인이 아니면(미리 보기) `open`이 거짓이고 주소는 null |

- `date`는 ISO 시각, `dateText`는 웹이 만든 한국어 날짜 (`2026년 11월 18일`).
- 없는 이름은 빈 칸으로 그려진다. 러너의 검사가 약속에 없는 이름을 알려 준다.
- 커뮤니티의 글 · 댓글은 회원이 쓴 글이다: 템플릿에서 링크로 바꾸거나 스크립트로 다시 그리지 않는다. 쓰기 폼은 템플릿에 두지 않는다 (격리된 화면에서는 보낼 수 없다, `community`의 고정 화면 주소로 링크한다).

## 스크립트

- 같은 데이터가 `<script id="cairn-data" type="application/json">`으로 페이지에 실린다: `JSON.parse(document.getElementById('cairn-data').textContent)`.
- 화면은 격리되어 열린다 (출처 없는 문서): 쿠키 · `localStorage` · 이 서버의 API를 쓸 수 없다. 상태는 메모리에만 둔다.
- 바깥으로의 요청(`fetch` · 글꼴 · 스크립트 · 폼)은 `cairn.json`의 `hosts`에 적은 호스트만 열린다. 그림은 https 어디서나 된다.

## cairn.json (없으면 바깥 주소 없음)

```json
{ "cairn": 1, "hosts": ["fonts.example.com"] }
```

- `hosts`는 정확한 호스트 이름만 10개까지 (와일드카드 · IP · 포트 없이). 지시가 바깥 서비스(글꼴 · 지도 · 댓글)를 요구할 때만 더한다.

## 고치는 법

1. `# 고칠 앱`의 폴더에서 지금 코드를 읽는다. 블로그 · 매거진 · 커뮤니티의 시작 코드면 `style.css`의 색 토큰(`--bg` · `--fg` · `--accent` …)과 어두운 화면 규칙이 있다: 색은 토큰을 바꿔 고친다. 페이지 앱은 시작 코드를 바탕으로 삼지 않고 위의 "페이지 앱" 대로 새로 만든다.
2. 지시에 맞게 바꾼 파일만 결과물 폴더에 둔다. 같은 이름의 파일은 통째로 바뀌므로 고친 전체를 낸다. 지우고 싶은 파일은 지울 수 없다: 쓰지 않게 바꾼다.
3. 폰에서 먼저 본다: 한 줄로 읽히게 쌓고 넓은 화면에서만 나란히 놓는다. 이미지에는 `alt`, 링크에는 알아볼 글자를 둔다.
4. 다시 읽어 확인한다: 여닫는 짝(`{{#…}}` · `{{/…}}`), 조각 이름(`{{> 이름}}`에 맞는 `이름.html`), `{{{ }}}`는 `post.html`에만, 링크는 `{{base}}` · `{{url}}`에서.
5. 답에는 바꾼 파일과 바꾼 까닭, 지시와 다르게 한 것을 적는다.
