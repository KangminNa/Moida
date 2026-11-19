---
paths:
  - "apps/web/**"
  - "plugins/*/web/**"
---

# 웹 코드 규칙

구조와 패턴은 [docs/객체설계.md](../../docs/객체설계.md) 6장 "콘솔 메뉴 하나의 구조"와 11장 "패턴 목록". 새 화면은 패턴의 본보기에서 시작한다.
`pnpm check`의 규칙 검사(`scripts/check-rules.mjs`)가 아래 ★ 표시를 지킨다.

| 파일 | 해도 되는 것 | 하면 안 되는 것 |
|---|---|---|
| `page.tsx` | 서버에서 그린다. 주소의 값 읽기, 첫 데이터가 꼭 필요할 때만 `serverGet`, 패널에 넘기기 | 상태, 버튼 처리, `'use client'` |
| `<이름>Panel.tsx` | 화면 하나. 읽기는 `useLiveValue`(나 그 위의 `_<모듈>/live.ts` 훅), 쓰기는 `useAction`. 폼의 저장도 패널이 돌린다 | ★ 불러오기를 손으로 쓰기(`useEffect` + GET), ★ `busy` · `problem` 상태를 손으로 만들기 |
| `<이름>Form.tsx` | 입력 칸의 상태, 보낼 본문 만들기 → `onSubmit(본문)`. 처음 값과 `busy` · `problem`은 props로 받고, 값이 바뀌면 패널이 `key`로 폼을 새로 만든다 | API 호출, `useAction`, 읽은 값으로 칸을 다시 채우는 `useEffect` |
| `_<모듈>/types.ts` | 서버 view에서 `import type`으로 만든 타입 (`ReturnType<XxxView['toJSON']>`) | ★ 응답 모양을 손으로 적기 (`api<{ … }>`도) |
| `_<모듈>/live.ts` | 여러 화면이 함께 쓰는 읽기 훅과 변경 신호의 주제 | 쓰기 |
| `_<모듈>/labels.ts` | 값 → 화면 문구 | 화면 조각 |
| `_lib/` | API 호출(`api` · `serverGet`), 공용 훅(`useLiveValue` · `useAction`) | 한 메뉴만 쓰는 것 |
| `_ui/` | 두 곳 이상에서 쓰는 화면 부품 | 한 메뉴만 쓰는 부품, 데이터 읽기 |

## 읽기와 쓰기

- 읽기: `useLiveValue(key, read, topics)`. 처음 한 번, 서버의 변경 신호가 올 때, 다시 연결될 때 읽는다. 다시 읽는 동안에도 앞의 값을 보여 준다 (오류와 값을 따로 그린다).
- 쓰기: `const action = useAction()` → `action.run(이름, () => api(…), { done, reload, conflict })`. 바쁨(`action.busy`) · 오류 문구(`action.problem`) · 아래 알림 · 다시 읽기 · 409 처리를 한 곳에서 한다. 줄마다 버튼이 있으면 이름에 그 줄의 id를 준다.
- 409는 다시 읽고 서버의 문구를 보여 준다. 본 `version`이 낡은 경우에만 `conflict`로 화면의 말을 준다 (서버 문구에는 판 번호가 있다). 이름이 겹침처럼 409가 다른 뜻이면 주지 않는다.
- 훅 하나는 한 번에 동작 하나만 돌린다. 함께 돌 수 있거나 오류를 다른 자리에 보여 줄 동작은 `useAction()`을 따로 둔다.
- 동작(`useAction`)은 다시 만들어지지 않는 쪽(패널)에 둔다. 폼 안에 두면 409 뒤에 다시 읽어 폼이 새로 만들어질 때 오류 문구가 함께 사라진다.
- 오류 문구는 `describe(error)`로만 만든다. 서버 오류의 `message`를 화면에서 다시 조립하지 않는다.
- 만들기는 `requestId`를 함께 보낸다 (응답을 못 받아 다시 눌러도 하나만 생기게). 고치기는 본 `version`을 함께 보낸다.

## 뒤로 가기 (웹 UX U1)

- 로그인 · 로그아웃 · 만든 뒤의 이동처럼 되돌아가면 안 되는 이동은 기록을 바꿔치기한다 (`location.replace` · `router.replace`). 로그인한 채 `/login`을 열면 돌아갈 곳으로 보낸다.
- 돌아갈 주소(`?return=`)는 `safeReturnPath`(`_lib/return-path.ts`)로만 읽는다 (서버의 `ReturnPath`와 같은 규칙, 웹 보안 S1).
- 시트처럼 화면 안에서 열고 닫는 것은 주소(쿼리, 예: 스토어의 `?make=`)에 둔다: 폰의 뒤로 가기가 그것만 닫고, 새로 고쳐도 그대로다. 주소의 값은 `page.tsx`가 읽어 넘긴다. 여기서 연 것이면 닫기는 뒤로, 주소로 바로 들어왔으면 바꿔치기.
- 콘솔이 뒤로 가기로 메모리(bfcache)에서 되살아나면 로그인을 물어 끝났으면 로그인 화면으로 (`admin/SignedOutBar.tsx`).

## 로그인 유지 (웹 UX U2)

- 로그인은 마지막으로 쓴 날부터 30일 (서버 `WebSession.DAYS`). 쿠키는 400일이고, 살아 있는지는 서버가 정한다.
- 로그인 화면으로 보낼 때는 `loginPath(돌아올 곳)`(`_lib/return-path.ts`)으로 지금 주소를 넘긴다. 서버에서 그리는 콘솔 틀은 지금 주소를 몰라 `proxy.ts`가 머리글(`RETURN_HEADER`)로 붙인다.
- 콘솔에서 API가 401 · 403이면(로그인이 끝나면 관리 API는 403) `api()`가 신호(`DENIED_EVENT`)를 내고, 콘솔 틀(`SignedOutBar`)이 정말 끝났는지 물어 "다시 로그인"을 띄운다. 쓰던 글이 사라지지 않게 화면을 바로 옮기지 않는다.

## 새 탭 (웹 UX U3)

- 사이트 안 이동은 같은 탭 (`target` 없이). 로그인 · 외부 계정 연결처럼 다녀오는 흐름도 같은 탭.
- 새 탭으로 여는 것: 다른 사이트(GitHub PR · 저장소 · AI 로그인 주소 · 소스 링크), 콘솔에서 공개 화면(앱 · 글 · 메뉴 · 페이지)과 결과물 보기를 열 때 (콘솔은 그대로 두고 보는 쪽을 새 탭에).
- ★ 새 탭은 늘 `target="_blank" rel="noopener noreferrer"`: 열린 쪽이 연 창(콘솔)을 바꿔치기하지 못하고, 주소가 Referer로 새지 않게. 코드로 열 때는 `window.open(주소, '_blank', 'noopener,noreferrer')`.
- 글 · AI 답(마크다운)의 http · https 링크는 `renderMarkdown`이 새 탭으로 그린다 (`_lib/markdown.ts`).

## 대화의 사진 (2026-11-19)

- 사진은 따로 올리는 길이 없다: 파일 올리기(`POST /api/outputs/files`)로 결과물이 되고 참조(`image`)로 붙는다. 사진인지는 서버가 앞부분으로 알아본 형식(`chat-photos.ts`의 `PHOTO_TYPES`)으로 정한다.
- 형식 · 크기 · 장수 규칙은 `admin/chats/chat-photos.ts` 한 곳 (서버 `TaskRefs.PHOTOS_MAX` · 러너 `JobPhotos.MAX_BYTES`와 같은 값). 미리보기는 `PhotoThumbs`(결과물의 `?inline=1`, 누르면 새 탭).

## 앱 화면 (스토어 1-6)

- 공개 앱의 화면(`/<앱>/…`)은 React 화면이 아니다. route handler 하나(`app/(blog)/[app]/[[...path]]/route.ts`)가 서버가 준 앱 코드의 템플릿(Mustache)에 데이터를 채워 격리 머리글(`sandbox`, `_blog/app-screen.ts`)과 함께 보낸다. 앱 화면의 모양은 앱 코드에서 고친다 (코드가 없는 앱의 시작 코드는 `apps/server/starters/`).
- 웹의 최상위 경로를 더하면 `next.config.ts`의 `WEB_ROUTES`에도 적는다 (화면 머리글이 붙는 목록, 구조 검사가 본다). 앱 주소에는 Cairn 화면 머리글을 붙이지 않는다.
- `mustache`는 `_blog/app-screen.ts`에서만 가져온다 (규칙 검사).

## 서버와 함께 쓰는 것

- ★ 서버 코드는 `import type`으로만 가져온다. 값(클래스 · 상수)을 가져오면 서버 코드가 브라우저 묶음에 들어간다.
- 서버 응답이 바뀌면 같은 변경에서 화면도 고친다. 순서는 표(마이그레이션) → 서버(input · view) → 웹(types · 화면).
- 웹은 DB에 닿지 않고 서버 API만 부른다.

## 모양

- 색 · 간격 · 그림자 · 모서리 토큰은 `globals.css`에만 둔다. 화면 코드에 색 값을 직접 적지 않는다. 강조색(`--accent`)은 주 동작(`cta` · 보내기 · 체크 · 나에게 온 것 · 포커스)에만, 빨강(`--danger`)은 배지 · 오류 · 실패에만 쓴다. 나머지는 중립 회색의 칠한 면 · 굵기 · 옅은 선과 떠 있는 층(`--float-*`)으로 구분한다 (테마 B, 기획서 결정 2026-11-16).
- 콘솔의 틀(2026-11-16 떠 있는 콘솔): 독(`admin/menu.tsx`의 `DOCK`, 보는 화면 다섯과 그 탭) · 옆 칸(대화 목록 · 설정 메뉴) · 카드. 새 화면은 독의 화면 탭(`pages`)이나 설정 묶음(`MENU`)에 한 줄로 더한다. 독 화면의 순서가 카드가 넘어가는 방향이다 (`admin/page-flip.ts`)
- 버튼 · 칸 · 목록은 `globals.css`의 클래스(`cta` · `ghost` · `field` · `input` · `list` · `panel` · `note` · `error`)를 쓴다. 같은 조각을 두 메뉴가 쓰게 되면 `_ui/`로 올린다.
- 화면 문구는 주어 없이 짧게, 한국어로 (AGENTS.md 코드 규칙).
- 같은 동작은 어느 화면에서든 같은 말로: 추가 · 편집 · 삭제(휴지통이 없는 것) · 휴지통으로 · 복원 · 연결 해제 · 승인/수정 요청/반려 · 맡기기. 화면에서는 "결재" 대신 "승인"(승인 대기 · 승인 필요), 외부 도구는 "커넥터", 소재는 "스크랩"이라고 쓴다 (기획서 결정 2026-11-15 화면 정리). 판(revision)은 화면에서 "버전". "주인"은 쓰지 않는다: 관리자의 표시 이름(`useMe().data?.name`), 이름을 모르는 곳은 "관리자" (기획서 결정 2026-11-14)
- 글자 크기는 `rem`으로 적는다 (px 금지): html 한 곳이 글자 크기 설정(작게 · 보통 · 크게)을 정해 함께 커지고 작아진다. 간격 · 칸 크기는 px. 폰 입력 칸의 16px만 예외 (iOS 확대 막기)
- 아이콘은 선 아이콘 `_ui/Icon.tsx`의 `<Icon name>`이다 (글자색을 따른다). 새 아이콘은 그 파일에 24칸 격자의 선 경로 한 줄로 더한다. 이모지는 쓰지 않는다.

## 크기와 이름

- ★ 파일 하나의 코드는 300줄까지 (빈 줄 · 주석 제외). 넘으면 개념 단위로 나눈다: 패널(읽기 · 틀)과 폼(칸), 그리는 조각.
- 플러그인 화면(`plugins/*/web`)은 react와 자기 폴더만 가져올 수 있어 공용 훅을 쓰지 못한다 (서버는 props의 `call`로 부른다).
- 이미 넘는 파일과 훅으로 옮기지 못한 화면은 `scripts/ratchet.json`에 있다 (남은 까닭은 `why`). 이 목록은 줄어들기만 한다: 새 항목을 더하지 않고, 고친 파일은 `node scripts/check-rules.mjs --update`로 지운다.
- `helpers` · `utils` · `common` · `misc` 같은 이름을 쓰지 않는다. 그 파일이 다루는 것의 이름을 붙인다.
- 안 쓰는 export · 파일은 `pnpm deadcode`(`pnpm check`에 들어 있다)가 막는다.
