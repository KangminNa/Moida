# community 모듈

## 하는 일
스토어 3단계 커뮤니티 ([docs/스토어.md](../../../../../docs/스토어.md) 11장, 인터페이스 11.5): 앱 도메인의 방문자가 아이디 · 비밀번호로 회원이 되어 글 · 댓글을 쓰고 신고한다.
관리자 계정(account)과 표 · 쿠키 · 권한을 나눈다 (원칙 10: 회원은 관리자가 아니다). 3-1a: 회원 · 가입 · 로그인 · 세션. 3-1b: 글 · 글 버전 · 댓글 · 쓰기 규칙. 3-1c 신고 · 임시 가림 · 관리자 결정 · 비밀번호 초기화는 다음 단계.

- `member/`: 회원(`Member`, 앱마다 따로) · 회원 세션(`MemberSession`, `cairn_member` 쿠키).
  규칙: 아이디 `LoginId`(영문 소문자로 시작하는 4~20자, 소문자로, 운영자로 보이는 아이디 막기, 바꾸지 않음) · 비밀번호 `MemberPassword`(10~200자, 아이디 · 닉네임과 같은 값 · 한 글자 되풀이 · 흔한 값 막기) · 닉네임 `Nickname`(2~20자 · 운영자로 보이는 이름 막기 · 겹침 열쇠, 7일에 한 번 바꿈) · 가입 대기 `Member.JOIN_WAIT_MS` · 차단(`blocked_until`, 무기한은 `Member.FOREVER`)이면 `assertActive`가 403.
  `MemberService`: 가입(`join`, 회원 + 첫 세션을 한 저장에, 아이디 · 닉네임이 겹치면 DB가 막고 409) · 로그인(`login`) · 비밀번호 바꾸기(`changePassword`, 지금 비밀번호 확인, 다른 로그인 끝냄: `Member.changePassword` → `MemberRepository.saveParts`) · 닉네임 바꾸기 · 로그아웃 · 마지막 접근. 해킹 대비는 서비스 머리 주석의 목록 (실패 문구 하나 · 같은 시간 · 시도 제한 · 가입 제한 · 새 세션)
  `api/community`(`MemberController`): `me` · `join` · `login` · `logout` · `PATCH me` · `PATCH me/password`. 가입 · 로그인 화면은 웹의 고정 화면(3-2)
- `topic/`: 글(`Topic` + 추가만 하는 버전 `topic_revisions`). 제목 · 본문이 바뀔 때마다 버전 하나, 쓴 회원의 지우기는 상태 `deleted`(내용 · 버전은 남는다, 원칙 2). 상태 `hidden` · `removed`는 3-1c. 쓰기 규칙은 `WriteLimits`(가입 대기는 `Member.assertCanWrite`, 시간 · 하루 한도, 링크 수, 같은 본문 24시간): 쓰기 트랜잭션에서 쓴 회원의 행을 먼저 잠그고 DB에서 센다.
  `api/community/topics`(`TopicController`): 목록(보이는 글, 최근부터 30개, `cursor`는 마지막 글 id) · 글 하나(보이는 댓글 200개까지 함께) · 쓰기 · 고치기 · 지우기. 읽기는 누구나(`TopicQuery`), 작성자는 닉네임만, 내 글 · 댓글이면 `version`
- `comment/`: 댓글(`Comment`). 보이는 글에만 달고(트랜잭션 전에 `TopicQuery.assertOpen`), 고치지 않는다(1차). `api/community/topics/:id/comments`(달기) · `api/community/comments/:id`(지우기, `CommentController`)
- `guard/member.guard.ts`: 커뮤니티 컨트롤러에만 붙는 요청자 정하기. 앱 도메인 요청(platform `HostGate`의 `appId`)에서만 회원 쿠키를 읽어 `MemberActor`로. 쓰기는 cross-site 403 · Origin이 있으면 그 앱 도메인 · 회원 쿠키를 실었으면 `X-Cairn-CSRF`(`MemberCsrf`, 서버 키 `member-csrf` HMAC)
- 모든 회원 API는 앱 도메인의 공개된 커뮤니티 앱에서만: 요청이 온 곳은 `MemberPlace`(앱 id · 출처 · IP, 기본 도메인이면 404), 공개된 커뮤니티 앱인지는 blog가 주는 Lookups `community-app`으로 (아니면 404)

## 소유 데이터
스키마 `community`: members, member_sessions, topics, topic_revisions(추가만), comments

## 데이터 묶음
- 회원: members + member_sessions (가입은 회원과 첫 세션을 한 저장에, 로그인은 세션 하나를 더하고, 비밀번호를 바꾸면 다른 세션을 끝낸다. `MemberRepository`의 `load` · `lock` 첫 값은 공간이 아니라 앱 id)
- 글: topics + topic_revisions. 댓글: comments. 둘 다 `load` · `lock`의 첫 값은 앱 id
- 같은 모듈의 묶음 넘나들기 (객체설계 4장 예외): 글 · 댓글을 쓰는 `TopicService` · `CommentService`는 쓴 회원의 행을 `MemberRepository.lock`으로 잠근다 (같은 회원의 쓰기를 줄 세워 한도를 정확히 세려고, 회원 행은 바꾸지 않는다). 잠그는 순서는 회원 → 글 · 댓글

## 공개 API (`index.ts`)
`CommunityModule`

## 내보내는 이벤트 / 받는 이벤트
아직 없다 (3-1c에서 `community.report.added` · `community.content.hidden`)

## 써도 되는 모듈
platform. blog의 앱은 platform `Lookups`의 `community-app`으로만 묻는다 (`modules.json`의 lookups.asks). 앱 도메인에서 여는 경로는 `HostGate.openPaths`로 등록한다 (`/api/community` 아래, `admin/`만 빼고 쓰기까지)

## 지켜야 할 것
- 회원 쿠키는 앱 도메인에서만 읽고, Domain 없이 그 도메인에만 둔다. 기본 도메인(콘솔과 같은 출처)에서는 회원 API가 없는 주소와 같다
- 회원은 권한이 없다 (`MemberActor.can`은 늘 false, 공간 없음): 다른 모듈의 읽기에는 방문자와 같다. 관리 일은 `assertOwner` 그대로
- 비밀번호는 해시(platform `PasswordHasher`)만 두고 어느 View · 로그에도 싣지 않는다. 해시를 만들고 확인하는 일은 느려서 트랜잭션 밖에서
- 로그인 실패는 늘 같은 문구 · 같은 시간 (없는 아이디도 `verify`가 가짜 값으로 같은 일을 한다): 아이디가 있는지 알려 주지 않는다
- 시도 제한(`AttemptLimiter`)은 앱 · 곳(IP, IPv6는 /64)마다 서버 메모리에서만 센다. IP · 이메일은 저장하지 않는다 (최소 수집)
- 다른 모듈과는 Lookups와 이벤트로만 (나중에 진입점만 다른 컨테이너로 뗄 수 있게, 스토어 11.2)

## 하지 말 것
- account · blog 등 다른 모듈 import, 다른 스키마에 SQL
- 관리자 쿠키를 읽거나 회원을 관리자처럼 다루기
