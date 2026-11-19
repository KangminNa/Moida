# community 모듈

## 하는 일
스토어 3단계 커뮤니티 ([docs/스토어.md](../../../../../docs/스토어.md) 11장, 인터페이스 11.5): 앱 도메인의 방문자가 아이디 · 비밀번호로 회원이 되어 글 · 댓글을 쓰고 신고한다.
관리자 계정(account)과 표 · 쿠키 · 권한을 나눈다 (원칙 10: 회원은 관리자가 아니다). 3-1a: 회원 · 가입 · 로그인 · 세션. 3-1b: 글 · 글 버전 · 댓글 · 쓰기 규칙. 3-1c: 신고 · 임시 가림 · 관리자 결정 · 차단 · 비밀번호 초기화 · 알림.

- `member/`: 회원(`Member`, 앱마다 따로) · 회원 세션(`MemberSession`, `cairn_member` 쿠키).
  규칙: 아이디 `LoginId`(영문 소문자로 시작하는 4~20자, 소문자로, 운영자로 보이는 아이디 막기, 바꾸지 않음) · 비밀번호 `MemberPassword`(10~200자, 아이디 · 닉네임과 같은 값 · 한 글자 되풀이 · 흔한 값 막기) · 닉네임 `Nickname`(2~20자 · 운영자로 보이는 이름 막기 · 겹침 열쇠, 7일에 한 번 바꿈) · 가입 대기 `Member.JOIN_WAIT_MS` · 차단(`blocked_until`, 무기한은 `Member.FOREVER`)이면 `assertActive`가 403.
  `MemberService`: 가입(`join`, 회원 + 첫 세션을 한 저장에, 아이디 · 닉네임이 겹치면 DB가 막고 409) · 로그인(`login`) · 비밀번호 바꾸기(`changePassword`, 지금 비밀번호 확인, 다른 로그인 끝냄: `Member.changePassword` → `MemberRepository.saveParts`) · 닉네임 바꾸기 · 로그아웃 · 마지막 접근. 해킹 대비는 서비스 머리 주석의 목록 (실패 문구 하나 · 같은 시간 · 시도 제한 · 가입 제한 · 새 세션)
  `api/community`(`MemberController`): `me` · `join` · `login` · `logout` · `PATCH me` · `PATCH me/password`. 가입 · 로그인 화면은 웹의 고정 화면(3-2)
- `topic/`: 글(`Topic` + 추가만 하는 버전 `topic_revisions`). 제목 · 본문이 바뀔 때마다 버전 하나, 쓴 회원의 지우기는 상태 `deleted`(내용 · 버전은 남는다, 원칙 2). 상태 `hidden`(가림: `hidden_by` reports · owner) · `removed`(관리자가 내림)는 `Moderation`의 규칙 (`Topic.decide` · `hideByReports`, 댓글도 같다). 쓰기 규칙은 `WriteLimits`(가입 대기는 `Member.assertCanWrite`, 시간 · 하루 한도, 링크 수, 같은 본문 24시간): 쓰기 트랜잭션에서 쓴 회원의 행을 먼저 잠그고 DB에서 센다.
  `api/community/topics`(`TopicController`): 목록(보이는 글, 최근부터 30개, `cursor`는 마지막 글 id) · 글 하나(보이는 댓글 200개까지 함께) · 쓰기 · 고치기 · 지우기. 읽기는 누구나(`TopicQuery`), 작성자는 닉네임만, 내 글 · 댓글이면 `version`
- `comment/`: 댓글(`Comment`). 보이는 글에만 달고(트랜잭션 전에 `TopicQuery.assertOpen`), 고치지 않는다(1차). `api/community/topics/:id/comments`(달기) · `api/community/comments/:id`(지우기, `CommentController`)
- `report/`: 신고(`Report`, 3-1c). 보이는 글 · 보이는 글의 보이는 댓글 하나에, 한 회원이 한 번(DB 부분 유일 색인 → 409), 내 것 422, 시간당 `WriteLimits.REPORTS_PER_HOUR`(429), 차단 403. 대상은 트랜잭션 전에 `TopicQuery.authorOf`로 읽고, 트랜잭션에서 신고한 회원 행을 잠근 뒤 센다. 저장하며 `community.report.added`. `api/community/reports`(`ReportController`, 회원만)
- `moderation/`: 관리 (3-1c). 가림 규칙 `Moderation`(임시 가림 기준 `HIDE_AT` 3명 · 결정 뒤의 상태 · 신고를 닫는 값 · 메모), 결정 기록 `Decision`(+ `decisions` 표, 추가만, 이벤트 `community.content.hidden` · `content.decided` · `member.decided`). `ModerationService`: `hideByReports`(일꾼: `ReportAddedHandler`가 `community.report.added`를 받아 대상을 잠그고 `decided_at` 뒤 서로 다른 회원의 열린 신고를 세어 가림) · `decide`(관리자: 가림 · 되돌림 · 내림, 열린 신고를 닫음) · `block` · `unblock` · `resetPassword`(임시 비밀번호 `MemberPassword.temporary`, 해시는 트랜잭션 밖, 모든 로그인을 끝냄, 답 `Member.resetView`에 한 번만). `ModerationQuery`: 관리 읽기(글 · 글 하나 · 신고 · 회원 · 결정 기록, 모든 상태, 쓴 회원의 아이디까지). `api/community/admin/:appId/…`(`ModerationController`, 관리자만, 기본 도메인에서만, 앱은 Lookups `community-app`으로 공간의 커뮤니티 앱인지)
- `community-notices.ts`(`CommunityNotices`): 신고로 가림(즉시, 관리자가 그 대상을 정하면 읽음) · 새 신고(묶어서, 앱마다 한 알림). 주소는 앱 관리의 커뮤니티 탭(`/admin/store/<앱>?tab=community`, 화면은 3-2)
- `guard/member.guard.ts`: 커뮤니티 컨트롤러에만 붙는 요청자 정하기. 앱 도메인 요청(platform `HostGate`의 `appId`)에서만 회원 쿠키를 읽어 `MemberActor`로. 쓰기는 cross-site 403 · Origin이 있으면 그 앱 도메인 · 회원 쿠키를 실었으면 `X-Cairn-CSRF`(`MemberCsrf`, 서버 키 `member-csrf` HMAC)
- 모든 회원 API는 앱 도메인의 공개된 커뮤니티 앱에서만: 요청이 온 곳은 `MemberPlace`(앱 id · 출처 · IP, 기본 도메인이면 404), 공개된 커뮤니티 앱인지는 blog가 주는 Lookups `community-app`으로 (아니면 404)

## 소유 데이터
스키마 `community`: members, member_sessions, topics, topic_revisions(추가만), comments, reports, decisions(추가만)

## 데이터 묶음
- 회원: members + member_sessions (가입은 회원과 첫 세션을 한 저장에, 로그인은 세션 하나를 더하고, 비밀번호를 바꾸면 다른 세션을 끝낸다. `MemberRepository`의 `load` · `lock` 첫 값은 공간이 아니라 앱 id)
- 글: topics + topic_revisions. 댓글: comments. 신고: reports. 결정 기록: decisions. 모두 `load` · `lock`의 첫 값은 앱 id
- 같은 모듈의 묶음 넘나들기 (객체설계 4장 예외): 글 · 댓글 · 신고를 쓰는 `TopicService` · `CommentService` · `ReportService`는 쓴 회원의 행을 `MemberRepository.lock`으로 잠근다 (같은 회원의 쓰기를 줄 세워 한도를 정확히 세려고, 회원 행은 바꾸지 않는다). 잠그는 순서는 회원 → 글 · 댓글 · 신고. `ModerationService`는 결정 하나에 대상(글 · 댓글 · 회원) · 열린 신고 · 결정 기록을 한 트랜잭션에서 쓴다 (잠그는 순서는 대상 → 신고)

## 공개 API (`index.ts`)
`CommunityModule`

## 내보내는 이벤트
칸의 원본은 `community.events.json`.

| 이벤트 | 내용 |
|---|---|
| `community.report.added` | `appId, reportId, reason, topicId, commentId`(둘 중 하나는 null). 회원이 신고함 |
| `community.content.hidden` | `appId, decisionId, reports, topicId, commentId`. 신고가 쌓여 시스템이 임시로 가림 (관리자 즉시 알림) |
| `community.content.decided` | `appId, decisionId, action, topicId, commentId`. 관리자가 글 · 댓글을 정함 (가림 알림을 읽음으로) |
| `community.member.decided` | `appId, decisionId, action, memberId`. 관리자가 회원을 차단 · 풀기 · 비밀번호 초기화 |

## 받는 이벤트
- `community.report.added`(자기 이벤트): 대상의 신고를 세어 임시로 가린다 (`ReportAddedHandler`). 두 번 받아도 한 번만 가린다

## 써도 되는 모듈
platform. blog의 앱은 platform `Lookups`의 `community-app`으로만 묻는다 (`modules.json`의 lookups.asks). 앱 도메인에서 여는 경로는 `HostGate.openPaths`로 등록한다 (`/api/community` 아래, `admin/`만 빼고 쓰기까지)

## 지켜야 할 것
- 회원 쿠키는 앱 도메인에서만 읽고, Domain 없이 그 도메인에만 둔다. 기본 도메인(콘솔과 같은 출처)에서는 회원 API가 없는 주소와 같다
- 회원은 권한이 없다 (`MemberActor.can`은 늘 false, 공간 없음): 다른 모듈의 읽기에는 방문자와 같다. 관리 일은 `assertOwner` 그대로
- 비밀번호는 해시(platform `PasswordHasher`)만 두고 어느 View · 로그에도 싣지 않는다. 해시를 만들고 확인하는 일은 느려서 트랜잭션 밖에서
- 로그인 실패는 늘 같은 문구 · 같은 시간 (없는 아이디도 `verify`가 가짜 값으로 같은 일을 한다): 아이디가 있는지 알려 주지 않는다
- 시도 제한(`AttemptLimiter`)은 앱 · 곳(IP, IPv6는 /64)마다 서버 메모리에서만 센다. IP · 이메일은 저장하지 않는다 (최소 수집)
- 다른 모듈과는 Lookups와 이벤트로만 (나중에 진입점만 다른 컨테이너로 뗄 수 있게, 스토어 11.2)
- 관리 API는 관리자 쿠키로 기본 도메인에서만 (`admin/`은 `HostGate`가 앱 도메인에 열지 않는다). 회원의 삭제 · 제재는 관리자의 결정으로만 (원칙 7 · 10): 시스템은 신고가 쌓였을 때 임시로 가리기만 한다
- 임시 비밀번호는 저장 · 로그에 남기지 않는다 (응답 한 번). 신고한 회원은 관리자에게만 닉네임으로 보인다

## 하지 말 것
- account · blog 등 다른 모듈 import, 다른 스키마에 SQL
- 관리자 쿠키를 읽거나 회원을 관리자처럼 다루기
