# 앱 코드 (스토어의 앱 화면)

블로그 · 매거진 · 페이지 앱은 앱마다 자기 코드(HTML 템플릿 · CSS · JS · 그림)로 그려진다.
웹이 방문자가 연 화면마다 템플릿을 골라 **Mustache**로 데이터를 채운다. 코드는 서버에서 실행되지 않는다.
지시문의 `# 고칠 앱` 단락에 지금 코드(가장 새 버전, 없으면 앱 종류의 시작 코드)가 적힌 폴더가 있다.

## 파일과 화면

| 화면 | 주소 | 템플릿 (없으면 `index.html`) |
|---|---|---|
| 첫 화면 | `/<앱>` | `index.html` |
| 글 하나 | `/<앱>/posts/<글>` | `post.html` |
| 메뉴 (글 목록 · 호 목록 · 페이지 목록 · 페이지) | `/<앱>/m/<메뉴>` | `list.html` |
| 매거진의 호 하나 | `/<앱>/m/<메뉴>/<번호>` | `issue.html` |
| 앱 안의 없는 주소 | | `404.html` (없으면 Cairn의 404) |

- `index.html`은 꼭 있어야 한다. 다른 템플릿은 없어도 된다.
- 페이지 앱은 페이지 없이도 만든다 (스토어 2-6): 그때 `pages`는 빈 목록이고 화면은 이 코드가 전부다. 도구 화면(일정표 · 계산기 · 지도)은 `index.html`과 스크립트로 만든다.
- 조각: `{{> header}}`는 같은 묶음의 `header.html`을 그 자리에 넣는다. 시작 코드는 `head` · `header` · `footer` · `post-list` · `page-list` · `issue-body`를 조각으로 쓴다.
- 파일은 폴더 없이 나란히 100개까지, 합쳐 20MB, 템플릿(.html)은 합쳐 1MB. 이름에 `/`를 넣지 않고 점으로 시작하지 않는다.
- 같은 묶음의 파일은 `{{files}}/style.css`처럼 연다. 앱의 첫 화면 링크는 `{{base}}`다 (미리 보기 주소에는 토큰이 들어 있어서 `/<앱>`을 직접 쓰면 미리 보기를 벗어난다).
- 앱 안의 링크는 같은 탭, 다른 사이트로 가는 링크는 `target="_blank" rel="noopener noreferrer"`로 새 탭에 연다. 글 본문(`post.html`)의 바깥 링크는 웹이 이미 그렇게 그린다.

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
| `screen` · `isHome` · `isPost` · `isMenu` · `isIssue` | 모두 | 화면 종류 (home · post · menu · issue · missing)와 그 표시 |
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

- `date`는 ISO 시각, `dateText`는 웹이 만든 한국어 날짜 (`2026년 11월 18일`).
- 없는 이름은 빈 칸으로 그려진다. 러너의 검사가 약속에 없는 이름을 알려 준다.

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

1. `# 고칠 앱`의 폴더에서 지금 코드를 읽는다. 시작 코드면 `style.css`의 색 토큰(`--bg` · `--fg` · `--accent` …)과 어두운 화면 규칙이 있다: 색은 토큰을 바꿔 고친다.
2. 지시에 맞게 바꾼 파일만 결과물 폴더에 둔다. 같은 이름의 파일은 통째로 바뀌므로 고친 전체를 낸다. 지우고 싶은 파일은 지울 수 없다: 쓰지 않게 바꾼다.
3. 폰에서 먼저 본다: 한 줄로 읽히게 쌓고 넓은 화면에서만 나란히 놓는다. 이미지에는 `alt`, 링크에는 알아볼 글자를 둔다.
4. 다시 읽어 확인한다: 여닫는 짝(`{{#…}}` · `{{/…}}`), 조각 이름(`{{> 이름}}`에 맞는 `이름.html`), `{{{ }}}`는 `post.html`에만, 링크는 `{{base}}` · `{{url}}`에서.
5. 답에는 바꾼 파일과 바꾼 까닭, 지시와 다르게 한 것을 적는다.
