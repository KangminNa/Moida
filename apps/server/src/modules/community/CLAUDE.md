# community 모듈

## 하는 일
스토어 3단계 커뮤니티 ([docs/스토어.md](../../../../../docs/스토어.md) 11장, 인터페이스 11.5): 앱 도메인의 방문자가 소셜 로그인으로 회원이 되어 글 · 댓글을 쓰고 신고한다.
관리자 계정(account)과 표 · 쿠키 · 권한을 나눈다 (원칙 10: 회원은 관리자가 아니다). 3-1a: 회원 · 소셜 로그인 · 세션. 3-1b 글 · 댓글 · 쓰기 규칙, 3-1c 신고 · 임시 가림 · 관리자 결정은 다음 단계.

- `member/`: 회원(`Member`, 앱마다 따로) · 회원 로그인(`member_logins`, 가입할 때 하나) · 회원 세션(`MemberSession`, `cairn_member` 쿠키). 닉네임 규칙은 `Nickname`(2~20자 · 운영자로 보이는 이름 막기 · 겹침 열쇠), 가입 대기 `Member.JOIN_WAIT_MS`, 닉네임은 7일에 한 번, 차단(`blocked_until`, 무기한은 `Member.FOREVER`)이면 `assertActive`가 403.
  소셜 로그인: platform 로그인 플러그인 중 회원용(`addLogin(…, { members: true })`, 지금은 `login-kakao`). `MemberQuery.start`가 상태 쿠키(`MemberCallbackInput`, 봉인 10분, 돌아갈 곳은 platform `ReturnPath`)와 보낼 주소를 만들고, 돌아오면 `MemberService.signIn`이 트랜잭션 밖에서 `login.finish` → 아는 회원이면 새 세션, 처음이면 가입 표(`JoinTicket`, 봉인 15분, 서버에 남기지 않음). 가입 `MemberService.join`은 회원 · 로그인 · 첫 세션을 한 저장에 (닉네임 · 로그인이 겹치면 DB가 막고 409).
  `api/community`(`MemberController`): `me` · `login/methods` · `login/:method/start` · `login/:method/callback` · `join` · `logout` · `PATCH me`. 가입 · 로그인 화면은 웹의 고정 화면(3-2): 앱 도메인의 `/_/join` · `/_/login`
- `guard/member.guard.ts`: 커뮤니티 컨트롤러에만 붙는 요청자 정하기. 앱 도메인 요청(platform `HostGate`의 `appId`)에서만 회원 쿠키를 읽어 `MemberActor`로. 쓰기는 cross-site 403 · Origin이 있으면 그 앱 도메인 · 회원(가입 중이면 가입 표) 쿠키를 실었으면 `X-Cairn-CSRF`(`MemberCsrf`, 서버 키 `member-csrf` HMAC)
- 모든 회원 API는 앱 도메인의 공개된 커뮤니티 앱에서만: 요청이 온 곳은 `MemberPlace`(앱 id · 출처, 기본 도메인이면 404), 공개된 커뮤니티 앱인지는 blog가 주는 Lookups `community-app`으로 (아니면 404)

## 소유 데이터
스키마 `community`: members, member_logins, member_sessions

## 데이터 묶음
- 회원: members + member_logins + member_sessions (가입은 셋을 한 저장에, 로그인은 세션 하나를 더한다. `MemberRepository`의 `load` · `lock` 첫 값은 공간이 아니라 앱 id)

## 공개 API (`index.ts`)
`CommunityModule`

## 내보내는 이벤트 / 받는 이벤트
아직 없다 (3-1c에서 `community.report.added` · `community.content.hidden`)

## 써도 되는 모듈
platform. blog의 앱은 platform `Lookups`의 `community-app`으로만 묻는다 (`modules.json`의 lookups.asks). 앱 도메인에서 여는 경로는 `HostGate.openPaths`로 등록한다 (`/api/community` 아래, `admin/`만 빼고 쓰기까지)

## 지켜야 할 것
- 회원 쿠키는 앱 도메인에서만 읽고, Domain 없이 그 도메인에만 둔다. 기본 도메인(콘솔과 같은 출처)에서는 회원 API가 없는 주소와 같다
- 회원은 권한이 없다 (`MemberActor.can`은 늘 false, 공간 없음): 다른 모듈의 읽기에는 방문자와 같다. 관리 일은 `assertOwner` 그대로
- 소셜 로그인 서비스와의 요청은 트랜잭션 밖에서 (`login.finish`)
- 회원 번호(`member_logins.subject`)는 그대로 둔다: HMAC으로 바꾸면 서버 키를 바꿀 때 되살릴 원문이 없다. 로그 · 보관 형식에는 넣지 않는다
- IP · 이메일 · 비밀번호를 저장하지 않는다 (최소 수집)
- 다른 모듈과는 Lookups와 이벤트로만 (나중에 진입점만 다른 컨테이너로 뗄 수 있게, 스토어 11.2)

## 하지 말 것
- account · blog 등 다른 모듈 import, 다른 스키마에 SQL
- 관리자 쿠키를 읽거나 회원을 관리자처럼 다루기
