# account 모듈

## 하는 일
블로그 공간과 설정, 블로그 주인(메일 · 비밀번호 로그인, 2026-11-26 전에 만든 계정은 아이디), 연결된 기기와 권한, 로그인 토큰.
요청이 들어오면 Guard가 토큰·쿠키를 확인해 Actor(`OwnerActor` · `DeviceActor` · `AgentActor` · `VisitorActor`)를 만든다.
M1 A(설치·주인 로그인)와 B(기기 연결, MCP OAuth 2.1)까지 있다.

- `space/`: 공간 (`Space`, 이름 · 소개 · 스토어 첫 화면의 한 줄 소개 `store.tagline` · 소개 글 `store.about` · 한눈에 `store.highlights`(한 줄에 하나 "제목: 설명") · 이름의 뜻 `store.naming`(2026-11-26, `Space.introduce`, `PUT api/space`의 tagline · about · highlights · naming: 보내지 않으면 그대로, 빈 글이면 지움)은 대화로도 바꾼다: `SpaceEdit` · `AccountSettings`, 2026-11-15 D. 사이트 주소 · 앱 연결 · 로고는 화면에서만), 설치 코드·통행증 규칙(`InstallPolicy`), `api/install`(코드 확인, 주인 계정 만들기)·`api/space`(+ `PUT api/space/hosted-apps`: ChatGPT·Claude 앱 연결 허용, 사이트 로고 `PUT api/space/logo` · `POST api/space/logo/delete` · 누구나 보는 `GET api/space/logo`)
- `owner/`: 주인 (`Owner` + `WebSession` + `LoginLink`), 비밀번호 규칙(`PasswordPolicy`), `api/auth`(로그인·로그아웃·비밀번호 바꾸기, 화면에 보일 이름 `PUT api/auth/me/profile`)
  메일 (2026-11-26, `OwnerMailService` · `OwnerMailController`): 설치는 메일 + 비밀번호(`users.login`에 메일). 비밀번호를 잊으면 `POST api/auth/password/code`(관리자 메일에만 코드, 답은 늘 204) → `POST api/auth/password/reset`(모든 로그인 끝남, `account.password.changed` via mail). 로그인 메일 바꾸기 `POST api/auth/email/code` → `PUT api/auth/email`(새 메일의 코드 + 지금 비밀번호, `Owner.useEmail`, `account.login.changed`): 아이디로 만든 계정을 메일로 옮기는 길. 코드는 서버 메모리(`VerifyCodes`), 메일은 platform `CodeMail`(메일 플러그인의 길, 없으면 502). 아이디 계정 · 메일 플러그인이 없을 때는 `pnpm run owner reset-password` 그대로
  보안 화면 (2026-11-15): `api/auth/sessions`(끝나지 않은 로그인 · 보안 설정 값, `OwnerQuery.sessions`), `POST api/auth/sessions/:id/end`(다른 곳의 로그인 하나, `Owner.endSessionById`: 지금 로그인은 422), `POST api/auth/sessions/end-others`(`Owner.endOtherSessions`). 로그인 · 로그아웃 · 끝내기 · 비밀번호는 `Owner`가 사건(`account.login.succeeded` · `account.session.ended` · `account.password.changed`)으로 남기고 `AccountSecurity`(`Outbox.listen`)가 같은 트랜잭션에서 platform의 보안 기록으로 옮긴다. 로그인 사건의 `newPlace`는 최근 90일 로그인한 곳(IPv4, IPv6는 /64)과 다른지다 (설치 때는 보지 않음). 틀린 · 막힌 로그인과 틀린 설치 코드 · 러너 연결은 엔티티의 사건이 없어 Service가 `SecurityLog`에 바로 남기고 오류에 `markRecorded()`. 틀린 아이디는 관리자의 것일 때만 적는다. 마지막 접근은 Guard가 알아본 로그인 · 기기마다 `OwnerService.seen` · `DeviceService.seen`(프로세스마다 5분에 한 번, version 안 올림, 실패해도 요청은 막지 않고 서버 로그)
  외부 로그인(`ExternalLoginQuery`·`ExternalLoginController`): 로그인 플러그인(`login:<이름>`)의 경로·확인값·쿠키, 계정 연결·끊기
- `device/`: 기기(`Device` + `DeviceCredential`), OAuth 클라이언트(`OAuthClient`), 승인 코드(`AuthorizationCode`), 승인 요청 규칙(`AuthorizationPolicy`).
  `OAuthController`(`/.well-known/*`, `/oauth/*`: 표준 경로라 /api 아래가 아님), `DeviceController`(`api/connect` 승인 화면, `api/devices` 기기 화면)
- 기기 권한 `delegate`(에이전트에게 맡기기, 2026-11-14): 관리자가 켠다. 그 기기의 AI 도구가 task의 MCP `ask_agent`로 서버 팀에 일을 맡기고 `agent_updates`로 그 대화의 소식 · 답을 읽는다 (스킬 `cairn-team`) (칸 기기는 받지 못한다: `devices_sandbox_only`)
- 기기 권한 `news`(소식 읽기, 2차 1-3): `cairn connect`가 OAuth 승인 요청에 `scope=news`를 실어 만드는 소식 기기만 갖는다 (내 컴퓨터의 훅 · 상태 줄이 task의 MCP `agent_updates`로 대화의 소식을 읽는다). 요청한 권한은 승인 요청(`ConsentInput`) → 승인 코드(`device_draft.scopes`) → `Device.connect`로 간다. 규칙은 `AuthorizationPolicy`: `news`만 보고, 다른 권한과 섞이거나 앱의 주소면 `invalid_scope`, `news`가 없으면 지금처럼 기본 권한
- 기기 모양 (2차 4단계): 앱이 승인 요청의 `scope`에 이름 하나를 실어 기기를 고른다 (`Device.PROFILES`): `news` → `news`, `collect` → `upload`(세션 저장 기기, `cairn connect`의 `SessionEnd` 훅), `extension` → `upload` · `delegate` · `inbox`(브라우저 확장). 섞어 요청하지 못하고, `news` · `collect`는 이 컴퓨터의 주소만, `extension`은 확장의 주소(`https://<확장 id a~p 32자>.chromiumapp.org/`, `OAuthClient.isExtension`)만, 확장의 주소는 `extension`만 요청한다 (`AuthorizationPolicy`). 승인 화면은 그 모양의 권한을 보인다 (`Device.scopesFor`). 권한 `inbox`(결재 · 질문 보기, task의 MCP `inbox`)는 관리자도 기기 메뉴에서 줄 수 있다
- 러너는 OAuth 없이 콘솔에서 만든다 (`POST api/devices/runner`, `Device.forRunner`). 권한은 `run` 하나, 토큰은 응답에 한 번
- 서버 러너는 스스로 연결한다 (`POST api/devices/server-runner`, `Device.forServerRunner`): 서버 키에서 만든 연결 값(`ServerRunnerPolicy`)을 서버가 시작할 때 볼륨에 쓰고(`ServerRunnerGateway`, `CAIRN_RUNNER_PAIRING_FILE`), 러너가 그 값을 내밀면 토큰을 준다
- 코드 러너 칸도 같은 길로 붙는다 (`POST api/devices/code-runner { secret, slot }`, `Device.forCodeRunner`, docs/코드작업.md). 연결 값은 서버 러너와 다르고(`codeSecret`, 파일 `CAIRN_CODE_PAIRING_FILE`, 0640: 칸의 러너는 root지만 남의 파일을 읽는 권한이 없어 node 그룹으로 읽는다) 칸마다 기기 하나("코드 러너 <칸>"). 권한은 `run` · `sandbox`로 정해져 있다
- 기본 도메인 (스토어 3-0): `AccountModule`이 platform `HostGate`에 사이트 주소 읽기를 등록하고, `SpaceService.rename`(사이트 주소를 바꾸는 길)이 저장 뒤 `HostGate.stale()`
- `guard/`: `ActorGuard` (앱 도메인으로 온 요청(`request.appHost`, platform `HostGate`)은 쿠키 · 토큰을 보지 않고 늘 방문자. 모든 요청: 작업 토큰 → `AgentActor`(작업이 살아 있는지는 mcp 모듈이 묻는다), 그 밖의 Bearer 토큰 → `DeviceActor`. 둘 다 `/mcp`에서만 요청자가 되고 REST에서는 방문자와 같다. 로그인 쿠키 → `OwnerActor`. 로그인 쿠키로 오는 쓰기 요청은 출처가 사이트 주소일 때만, 아니면 403 `origin`. 다만 브라우저가 `Sec-Fetch-Site: same-origin`이라 밝히고 `Origin`이 이 요청이 온 주소면 통과: 새 도메인으로 옮길 때 새 주소의 콘솔이 사이트 주소를 바꾸지 못하던 막힘, 2026-11-26. 콘솔은 사이트 주소와 다른 주소로 열면 `SiteAddressBar`가 지금 주소로 바꿀지 묻는다). 로그인은 마지막으로 쓴 날부터 30일(`WebSession.DAYS`): 마지막 접근을 적을 때(`OwnerService.seen`, 5분에 한 번) `expires_at`도 늘린다. 쿠키는 400일(`WebSession.COOKIE_SECONDS`)이고 살아 있는지는 `expires_at`이 정한다 (웹 UX U2)

엔티티는 `TableEntity`(platform)로 표 한 줄을 들고, Repository(`TableRepository`)는 바뀐 칸만 저장한다 (객체설계 6장). 칼럼을 아는 곳은 `account.tables.ts`, Entity의 `RULES`, Input의 `COLUMNS`, View의 `toJSON`이다.
- `Space`는 이름만 칸이고 소개 · 사이트 주소 · 앱 연결 허용은 settings의 값이다(`LoadedSpace`, 키는 `SpaceView`). 저장할 때 `saveParts`가 설정을 모두 다시 적는다
- `Space` · `Device`는 칸이 그대로여도(설정 · 토큰만 바뀌어도) 저장하면 version이 오른다. `Owner`는 users에 space_id가 없어 `BaseRepository`로 바뀐 칸만 저장하고, 칸이 그대로여도 계정 행을 고친다 (같은 주인의 저장이 그 행에서 차례를 기다린다). users의 version은 표시 이름을 고칠 때만 오르고(`Owner.rename`), 그 저장만 읽은 판일 때 쓴다 (사이에 다른 이름 저장이 끼면 409). 로그인 · 비밀번호 저장은 version을 보지도 올리지도 않는다
- `OAuthClient` · `AuthorizationCode`는 열쇠가 id가 아니라(client_id · code_hash) `BaseEntity`로 새 행을 들고 저장한다
- 토큰 · 해시 · 비밀번호 해시는 어떤 View에도 없다. 원문은 만든 순간의 응답에만 실린다 (`DeviceSavedView`의 token, `TokenView`, 로그인 쿠키)

## 소유 데이터
스키마 `account`: spaces, users, login_links, space_members, settings, devices, oauth_clients, oauth_codes, oauth_tokens, device_tokens, web_sessions

## 데이터 묶음
- 공간: spaces + settings (블로그 이름·소개, 스토어 한 줄 소개 · 소개 글, GitHub 앱, 사이트 주소, 앱 연결 허용 `connect.hosted_apps`)
- 주인: users + space_members + web_sessions + login_links (주인은 공간마다 한 명, DB가 막는다)
- 기기: devices + device_tokens + oauth_tokens + oauth_clients + oauth_codes (M1 B)

## 공개 API (`index.ts`)
`AccountModule`(Guard 포함), 설치 코드(`InstallPolicy`)와 설치 상태(`SpaceQuery`): 명령줄·서버 시작 로그가 쓴다.
`DeviceQuery`: mcp 모듈이 401 안내 주소를 만들 때. `ServerRunnerGateway`: 서버 시작 때 서버 러너 · 코드 러너 칸의 연결 값을 쓴다 (`main.api.ts`).
`ServerRunnerPolicy`: 테스트가 서버 러너 · 칸처럼 연결할 때 (`ApiClient.codeRunner`, 러너 통합 테스트)

## 내보내는 이벤트 / 받는 이벤트
칸의 원본은 `account.events.json` (리팩토링 R3c): 여기는 뜻을 적고, 칸이 바뀌면 그 파일을 고친다. 목록에 없는 주제 · 칸은 내보낼 때 막힌다.

`account.owner.claimed`(주인이 정해짐), `account.device.connected`, `account.device.revoked`(`reason`: owner · token_reused), `account.login.succeeded`(`sessionId, method, newPlace, ip, userAgent`), `account.session.ended`(`how`: logout · ended · others), `account.password.changed`(`via`: web · command · mail), `account.login.changed`(로그인 메일 바꿈), `account.setting.changed { approvalId, outcome, error? }`(승인한 사이트 설정 바꾸기의 결과, 2026-11-15 D) / 없음 (승인한 설정 바꾸기는 task의 처리기가 platform `SettingKinds`로 넘긴다)

알리는 것 (`AccountNotices`, 7단계. platform `NoticeCatalog`에 등록): `account.device.connected` 새 기기 연결 (즉시, 기기마다 묶음 키). 보안 화면 (2026-11-15): `account.login.new_place` 새 곳에서 로그인 (즉시, 로그인 사건의 `newPlace`), `account.login.blocked` 로그인 막힘 (즉시, 관리자의 아이디로 막혔을 때 `OwnerService`가 `Notices.post`로, 같은 곳은 1분에 한 번)

## 써도 되는 모듈
platform

## 지켜야 할 것
- 화면에는 "주인" 대신 표시 이름(`OwnerView.name`: 정한 이름, 없으면 아이디)을 쓴다. 이름을 모르는 곳(방문자에게 보이는 오류)은 "관리자". 표시 이름은 주인만 읽는다 (`api/auth/me`). 공개 정보(`SpaceView`)에 넣지 않는다
- 사이트 로고는 그림만 (형식은 파일 앞부분으로 `FileSniff`, PNG · JPEG · WebP · GIF, 1MB. SVG는 스크립트를 담을 수 있어 받지 않는다). 파일은 트랜잭션 밖에서 `BlobStore.save`, 공간에는 해시만. 가리키는 칸은 `registerUse`로 등록한다 (`SpaceQuery.usedBlobs`). 보내기는 `nosniff` + sandbox CSP
- 관리 일(기기 목록·권한·토큰·끊기, 승인 화면, 사이트 정보·앱 연결 허용, 연결된 로그인)은 `assertOwner()`로 막는다. `assertCan(WRITE)`는 write 기기도 통과한다. 기기 토큰은 `/mcp`에서만 요청자가 되지만(`ActorGuard`, 2026-11-06), 관리 일은 Service에서도 한 번 더 막는다 (두 겹). API 테스트에 write 기기 경우를 둔다 (`device.api.test.ts`)
- 비밀값(플러그인의 client secret 등)은 플러그인 설정에 서버 키로 잠가서만 저장하고(platform), 응답·로그에 내보내지 않는다
- 토큰(로그인·기기)은 해시만 저장한다. 원문은 만든 순간의 응답(쿠키)에만
- 주인은 공간마다 한 명 (DB 부분 유일 인덱스)
- 비밀번호는 `PasswordHasher`로 바꾼 값만. 틀렸을 때는 아이디가 없어도 같은 문구·같은 시간 (아이디가 있는지 알 수 없게)
- 외부 로그인(GitHub 등)은 코어에 두지 않는다. 로그인 플러그인이 더하고, `login_links`에 연결된 계정으로만 로그인된다
- 로그인 뒤 돌아갈 곳은 이 사이트 안의 경로만 (`ReturnPath`: 브라우저와 같은 URL 해석으로 출처가 그대로인지 보고 해석한 경로로 보낸다. `/\evil.com` · 탭이 낀 값은 `//evil.com`으로 읽혀 거절. 웹의 `safeReturnPath`와 같은 규칙, 웹 보안 S1)
- 기기는 지우지 않고 `revoked_at`으로 끊는다 (다른 모듈이 기기 id를 값으로 갖고 있다). 끊으면 모든 토큰이 바로 무효
- OAuth 오류는 `OAuthError`({ error, error_description }) 모양으로. AI 도구는 이 모양만 읽는다
- 갱신 토큰은 한 번만 쓴다. 이미 쓴 것이 다시 오면 기기를 끊는다 (도난 감지)
- 사이트 주소는 https만 (`localhost` · `127.0.0.1` · `[::1]` · `*.localhost`만 http도)
- 돌려보낼 주소(redirect_uri)는 이 컴퓨터(localhost · 127.0.0.1 · [::1]), 브라우저 확장의 주소(브라우저가 그 확장에게만 넘긴다, 2차 4단계)와, 주인이 "앱 연결 허용"을 켰을 때만 claude.ai · chatgpt.com의 정해진 콜백 주소(`OAuthClient`의 목록). 남이 보낸 승인 링크를 눌러도 열쇠는 내 컴퓨터나 직접 켠 앱으로만 간다. 앱의 연결이면 승인 화면이 앱 이름(`ConsentView.app`)과 경고를 보인다. 승인 응답에는 `iss`(RFC 9207)
- 스스로 등록(`/oauth/register`)은 한 곳(IPv4 하나, IPv6는 /64, `AttemptLimiter.place`)에서 1시간 20번. 하루가 지나도록 토큰을 받지 않은 등록은 새 등록 때 지운다
- 서버 러너: 공간마다 살아 있는 것은 하나 (살아 있는 기기 이름의 유일 인덱스, 이름 "서버 러너"). 연결할 때마다 같은 기기의 기기 토큰을 모두 막고 새로 준다. 주인(user)이 없다. 연결은 한 곳에서 1시간 30번, 설치 전에는 409. 연결 값과 토큰은 로그·응답 밖으로 내보내지 않는다 (토큰은 연결 응답에 한 번)
- 소식 기기: `news`는 다른 권한과 함께 두지 않는다 (`Device.edit`이 권한 바꾸기를 막고, `ALL_SCOPES`에 없어 다른 기기에 줄 수 없고, DB CHECK `devices_news_only`). 안내 문서의 `scopes_supported`에 넣지 않는다: 그 목록을 통째로 요청하는 AI 도구가 섞인 요청으로 막히지 않게
- 코드 러너 칸: `sandbox`는 칸으로 연결할 때만 생긴다. 주인이 다른 기기에 줄 수 없고(`ALL_SCOPES`에 없음), 칸 기기의 이름 · 권한은 바꿀 수 없다 (`Device.edit`, 바꾸면 칸이 새 기기를 만들어 쌓인다). DB도 `sandbox` 기기는 `run` · `sandbox`만 갖게 막는다 (CHECK `devices_sandbox_only`). 연결 값은 서버 러너와 섞지 않는다: 칸이 서버 러너로 붙어 브라우저 작업을 받거나, 서버 러너가 칸으로 붙어 셸 있는 일을 받지 못하게
- URL·쿠키에 싣는 짧은 값은 `SecretBox.pack`으로 암호화한다 (서명만 하지 않는다). 용도를 꼭 넣는다: 승인 요청 `oauth-consent`, 외부 로그인 쿠키 `external-login:<방법>`, 설치 통행증 `install`. 열쇠가 같아 용도가 없으면 한 자리의 값이 다른 자리에서 풀린다

## 하지 말 것
- 다른 모듈의 테이블 접근, vault·blog import
- 비밀번호 원문을 저장·기록하기 (로그, 응답, 이벤트 모두)
