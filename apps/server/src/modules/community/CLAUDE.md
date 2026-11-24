# community 모듈

## 하는 일
스토어 3단계 커뮤니티 ([docs/스토어.md](../../../../../docs/스토어.md) 11장, 인터페이스 11.5): 앱 도메인의 방문자가 아이디 · 비밀번호로 회원이 되어 글 · 댓글을 쓰고 신고한다.
관리자 계정(account)과 표 · 쿠키 · 권한을 나눈다 (원칙 10: 회원은 관리자가 아니다). 3-1a: 회원 · 가입 · 로그인 · 세션. 3-1b: 글 · 글 버전 · 댓글 · 쓰기 규칙. 3-1c: 신고 · 임시 가림 · 관리자 결정 · 차단 · 비밀번호 초기화 · 알림.
화면(3-2, 스토어 11.6)은 웹이 이 API로 그린다: 목록 · 글은 앱 코드의 템플릿에 웹이 `me` · `topics` · `topics/:id`를 앱 도메인으로 읽어 채우고, 가입 · 로그인 · 글쓰기 · 댓글 · 신고는 앱 도메인의 고정 화면 `/_/…`, 관리는 앱 관리의 커뮤니티 탭. 응답 모양은 웹이 view의 `toJSON` 반환 타입으로 쓴다 (`toJSON(): object`로 적지 않고 안쪽 view는 `.toJSON()`으로 펼친다)

앱 플랫폼 (스토어 12장, 2026-11-22)부터 이 모듈은 "앱의 회원 쪽 전체"다: 회원은 커뮤니티 앱뿐 아니라 선언서(`cairn.json`)에 `members`를 적은 모든 앱이 받고(Lookups `member-app`), 앱이 선언한 표의 데이터(`data/`)도 여기 있다. 글 · 댓글 · 신고는 지금처럼 커뮤니티 앱만(`community-app`).

- `data/`: 앱 데이터 (스토어 12.4). 앱마다 Postgres 스키마 `app_<앱 id 16진 32자>`에 선언한 표가 실제 표로 생긴다. 열린 표 · 칸 · 규칙의 목록은 `community.app_tables`(`AppTable`: 값 검사 `checked` · 조건 `filterOf` · 정렬 `assertSortable` · 한도).
  맞추기: `blog.app_code.shown`(`AppTablesHandler`) → `AppDataService.apply`가 없는 스키마 · 표 · 칸을 더하고 정책(`cairn_read` · `cairn_insert` · `cairn_update` · `cairn_delete`)을 다시 건다 (`AppTableRepository.ensure`). 지우는 DDL은 없다: 선언에서 빠진 표는 닫기만 한다(`open = false`, 줄은 남는다).
  회원 쪽 `api/community/data/:table`(`AppDataController`, 앱 도메인 · `MemberGuard`): 읽기 · 넣기 · 고치기 · 지우기. 쿼리는 트랜잭션 안에서 `cairn.member`(회원 id) · 5초 제한 · `SET LOCAL ROLE cairn_app`을 정한 뒤 돈다(`AppTableRepository.asMember`): 규칙(`anyone` · `member` · `owner` · `admin`)은 DB의 행 수준 보안이 거른다. 이 뒤에는 community의 다른 표를 읽지 못하므로 회원 확인은 그 앞에서 한다.
  관리자 `api/community/admin/:appId/data`(표 목록 · 줄 읽기 · 넣기 · 지우기) · `…/export`(`tables.json` · `schema.sql` · `data.sql` · `members.json`의 zip). 역할을 바꾸지 않는다.
  남은 데이터 (2026-11-23): `AppDataQuery.holdings`가 앱마다 회원 수 · 앱 데이터 줄 수를 세어 Lookups `app-holdings`로 준다 (관리자만, 없는 앱은 빠짐). blog가 앱을 지우기 전에 묻고, 있으면 지우지 않는다.
  일꾼의 넣기는 설정 바꾸기 제안 `app_data`(`AppDataService.SETTING` · `rehearseSetting` · `applySetting`, `community-settings.ts`가 등록, 승인 뒤 반영: 원칙 7). 넣기만 한다.
- `member/`: 회원(`Member`, 앱마다 따로) · 회원 세션(`MemberSession`, `cairn_member` 쿠키).
  규칙: 아이디 `LoginId`(영문 소문자로 시작하는 4~20자, 소문자로, 운영자로 보이는 아이디 막기, 바꾸지 않음) · 비밀번호 `MemberPassword`(10~200자, 아이디 · 닉네임과 같은 값 · 한 글자 되풀이 · 흔한 값 막기) · 닉네임 `Nickname`(2~20자 · 운영자로 보이는 이름 막기 · 겹침 열쇠, 7일에 한 번 바꿈) · 가입 대기 `Member.JOIN_WAIT_MS` · 차단(`blocked_until`, 무기한은 `Member.FOREVER`)이면 `assertActive`가 403.
  `MemberService`: 가입(`join`, 회원 + 첫 세션을 한 저장에, 아이디 · 닉네임이 겹치면 DB가 막고 409) · 로그인(`login`) · 비밀번호 바꾸기(`changePassword`, 지금 비밀번호 확인, 다른 로그인 끝냄: `Member.changePassword` → `MemberRepository.saveParts`) · 닉네임 바꾸기 · 로그아웃 · 마지막 접근. 해킹 대비는 서비스 머리 주석의 목록 (실패 문구 하나 · 같은 시간 · 시도 제한 · 가입 제한 · 새 세션)
  `api/community`(`MemberController`): `me` · `join` · `login` · `logout` · `PATCH me` · `PATCH me/password` · `me/leave`(3-4). 가입 · 로그인 화면은 웹의 고정 화면(3-2).
  `me`의 `csrf`는 회원 쿠키가 있으면 로그인이 끝났어도 그 쿠키의 값이다: 쿠키를 실은 쓰기는 이 값이 있어야 해서(MemberGuard), 끝난 로그인의 쿠키가 남은 브라우저(비밀번호 초기화 · 30일)도 다시 로그인 · 가입한다
- `topic/`: 글(`Topic` + 추가만 하는 버전 `topic_revisions`). 제목 · 본문이 바뀔 때마다 버전 하나, 쓴 회원의 지우기는 상태 `deleted`(내용 · 버전은 남는다, 원칙 2). 상태 `hidden`(가림: `hidden_by` reports · owner) · `removed`(관리자가 내림)는 `Moderation`의 규칙 (`Topic.decide` · `hideByReports`, 댓글도 같다). 쓰기 규칙은 `WriteLimits`(가입 대기는 `Member.assertCanWrite`, 시간 · 하루 한도, 링크 수, 같은 본문 24시간): 쓰기 트랜잭션에서 쓴 회원의 행을 먼저 잠그고 DB에서 센다.
  `api/community/topics`(`TopicController`): 목록(보이는 글, 최근부터 30개, `cursor`는 마지막 글 id) · 글 하나(보이는 댓글 200개까지 함께) · 쓰기 · 고치기 · 지우기. 읽기는 누구나(`TopicQuery`), 작성자는 닉네임만, 내 글 · 댓글이면 `version`
- `comment/`: 댓글(`Comment`). 보이는 글에만 달고(트랜잭션 전에 `TopicQuery.assertOpen`), 고치지 않는다(1차). `api/community/topics/:id/comments`(달기) · `api/community/comments/:id`(지우기, `CommentController`)
- `report/`: 신고(`Report`, 3-1c). 보이는 글 · 보이는 글의 보이는 댓글 하나에, 한 회원이 한 번(DB 부분 유일 색인 → 409), 내 것 422, 시간당 `WriteLimits.REPORTS_PER_HOUR`(429), 차단 403. 대상은 트랜잭션 전에 `TopicQuery.authorOf`로 읽고, 트랜잭션에서 신고한 회원 행을 잠근 뒤 센다. 저장하며 `community.report.added`. `api/community/reports`(`ReportController`, 회원만)
- `moderation/`: 관리 (3-1c). 가림 규칙 `Moderation`(임시 가림 기준 `HIDE_AT` 3명 · 결정 뒤의 상태 · 신고를 닫는 값 · 메모), 결정 기록 `Decision`(+ `decisions` 표, 추가만, 이벤트 `community.content.hidden` · `content.decided` · `member.decided`). `ModerationService`: `hideByReports`(일꾼: `ReportAddedHandler`가 `community.report.added`를 받아 대상을 잠그고 `decided_at` 뒤 서로 다른 회원의 열린 신고를 세어 가림) · `decide`(관리자: 가림 · 되돌림 · 내림, 열린 신고를 닫음) · `block` · `unblock` · `resetPassword`(임시 비밀번호 `MemberPassword.temporary`, 해시는 트랜잭션 밖, 모든 로그인을 끝냄, 답 `Member.resetView`에 한 번만). `ModerationQuery`: 관리 읽기(글 · 글 하나 · 신고 · 회원 · 결정 기록, 모든 상태, 쓴 회원의 아이디까지). `api/community/admin/:appId/…`(`ModerationController`, 관리자만, 기본 도메인에서만, 앱은 Lookups `community-app`으로 공간의 커뮤니티 앱인지)
- 신고 검토 (3-3, 2026-11-24, 스토어 11.7): `hideByReports`가 신고마다 검토 일을 요청한다 (`ReviewRequest`: `task.task.requested`, kind `community_review`, requestId는 대상 · 관리자가 마지막으로 정한 때마다 하나, 담당 없음, 지시는 대상 id뿐). 일꾼은 MCP `community_case`(`ReviewQuery.caseOf`: 대상 · 쓴 회원(닉네임 · 지난 가림 · 내림 · 차단 수, 아이디 없음) · 신고(신고한 회원 없음))로 읽고 설정 제안 `moderation`(`ModerationChange`: 글 · 댓글 `state` · `open_reports` 0, 회원 `blocked_until`)을 올린다. 지금 값은 `ReviewQuery.settingNow`, 미리 해 보기 · 승인 뒤 적용은 `ModerationService.rehearseSetting` · `applySetting`(관리자 결정과 같은 `contentIn` · `memberIn`, 기록 `by_kind` approved · by_id 승인한 관리자, 마이그레이션 `community_decision_approved`). `get_settings moderation`은 열린 신고가 있는 대상(`ReviewQuery.queue`). 도구 목록은 `community-tools.ts`(`CommunityTools`, 설명 `community.tools.ko.json`, mcp 모듈이 모은다)
- `terms/`: 약관 (3-4, 2026-11-24, 스토어 11.8). `Term`(추가만 하는 버전, 앱마다 `terms` · `privacy`, 공개된 것은 마지막 버전). `TermsService.publish`(관리자, 본 버전 다음으로만 · 낡으면 409) · `rehearseSetting` · `applySetting`(설정 제안 `terms`, 승인 뒤 · 제안 때 본 본문과 지금 본문이 다르면 실패). `TermsQuery`: 회원 화면(`published`, 없으면 404) · 관리(지금 버전 · 초안 · `ready`) · 가입 확인(`versions`). 초안은 `TermsDraftGateway`(`apps/server/starters/terms/*.md`, `{{app}}`). `api/community/terms/:kind`(`TermsController`, 앱 도메인 · `MemberGuard`) · `api/community/admin/:appId/terms[/:kind]`(`TermsAdminController`)
  가입(`MemberService.join`)은 둘 다 공개되고 본 버전이 지금 버전이어야 한다(409), 동의한 버전을 회원 행에. 탈퇴(`leave`, `POST api/community/me/leave`): 비밀번호 확인(해시는 트랜잭션 밖) → `Member.leave`가 아이디 · 해시 · 닉네임 · 열쇠 · 차단 메모 · 마지막 접근을 지우고 `left_at` · 모든 세션 끝냄. 탈퇴한 회원은 `findByLogin`에서 빠지고 관리 view의 아이디는 null, 닉네임 정책은 "탈퇴"를 막는다
- `community-notices.ts`(`CommunityNotices`): 신고로 가림(즉시, 관리자가 그 대상을 정하면 읽음) · 새 신고(묶어서, 앱마다 한 알림). 주소는 앱 관리의 커뮤니티 탭(`/admin/store/<앱>?tab=community`, 화면은 3-2)
- `guard/member.guard.ts`: 커뮤니티 컨트롤러에만 붙는 요청자 정하기. 앱 도메인 요청(platform `HostGate`의 `appId`)에서만 회원 쿠키를 읽어 `MemberActor`로. 쓰기는 cross-site 403 · Origin이 있으면 그 앱 도메인 · 회원 쿠키를 실었으면 `X-Cairn-CSRF`(`MemberCsrf`, 서버 키 `member-csrf` HMAC)
- 모든 회원 API는 앱 도메인의 공개된 커뮤니티 앱에서만: 요청이 온 곳은 `MemberPlace`(앱 id · 출처 · IP, 기본 도메인이면 404), 공개된 커뮤니티 앱인지는 blog가 주는 Lookups `community-app`으로 (아니면 404)

## 소유 데이터
스키마 `community`: members, member_sessions, topics, topic_revisions(추가만), comments, reports, decisions(추가만), terms(추가만), app_tables
스키마 `app_<앱 id>` (앱마다, 실행 중에 생긴다): 앱이 선언한 표. 마이그레이션 · 표 인터페이스에 없고 `AppTableRepository`만 다룬다. 역할 `cairn_app`(로그인 없음, 이 스키마들에만 권한)은 마이그레이션이 만든다

## 데이터 묶음
- 회원: members + member_sessions (가입은 회원과 첫 세션을 한 저장에, 로그인은 세션 하나를 더하고, 비밀번호를 바꾸면 다른 세션을 끝낸다. `MemberRepository`의 `load` · `lock` 첫 값은 공간이 아니라 앱 id)
- 앱 데이터: app_tables + 그 앱 스키마의 표 (`AppTableRepository`: `lockApp`으로 앱 단위로 줄 세운다)
- 글: topics + topic_revisions. 댓글: comments. 약관: terms. 신고: reports. 결정 기록: decisions. 모두 `load` · `lock`의 첫 값은 앱 id
- 같은 모듈의 묶음 넘나들기 (객체설계 4장 예외): 글 · 댓글 · 신고를 쓰는 `TopicService` · `CommentService` · `ReportService`는 쓴 회원의 행을 `MemberRepository.lock`으로 잠근다 (같은 회원의 쓰기를 줄 세워 한도를 정확히 세려고, 회원 행은 바꾸지 않는다). 잠그는 순서는 회원 → 글 · 댓글 · 신고. `ModerationService`는 결정 하나에 대상(글 · 댓글 · 회원) · 열린 신고 · 결정 기록을 한 트랜잭션에서 쓴다 (잠그는 순서는 대상 → 신고)

## 공개 API (`index.ts`)
`CommunityModule`, `CommunityTools`(MCP 도구 목록, mcp 모듈이 모은다)

## 내보내는 이벤트
칸의 원본은 `community.events.json`.

| 이벤트 | 내용 |
|---|---|
| `community.report.added` | `appId, reportId, reason, topicId, commentId`(둘 중 하나는 null). 회원이 신고함 |
| `community.content.hidden` | `appId, decisionId, reports, topicId, commentId`. 신고가 쌓여 시스템이 임시로 가림 (관리자 즉시 알림) |
| `community.content.decided` | `appId, decisionId, action, topicId, commentId`. 관리자가 글 · 댓글을 정함 (가림 알림을 읽음으로) |
| `community.member.decided` | `appId, decisionId, action, memberId`. 관리자가 회원을 차단 · 풀기 · 비밀번호 초기화 |
| `community.setting.changed` | 승인된 설정 제안(`app_data` · `moderation` · `terms`)을 반영함 (task가 결재 · 결과 카드에 잇는다) |
| `task.task.requested` (task의 주제) | 신고 검토 일 요청 (`ReviewRequest`, 3-3) |

## 받는 이벤트
- `community.report.added`(자기 이벤트): 대상의 신고를 세어 임시로 가린다 (`ReportAddedHandler`). 두 번 받아도 한 번만 가린다
- `blog.app_code.shown`: 보이는 버전이 선언한 표에 맞춘다 (`AppTablesHandler`). 두 번 받아도 같다 (맞춘 버전 `applied_seq`보다 옛 것은 넘긴다)

## 써도 되는 모듈
platform. 앱마다 남은 회원 · 앱 데이터는 Lookups `app-holdings`로 준다 (blog의 앱 지우기). blog의 앱은 platform `Lookups`로만 묻는다 (`modules.json`의 lookups.asks): `community-app`(공개된 커뮤니티 앱: 글 · 댓글 · 신고) · `member-app`(회원을 받는 공개 앱: 회원 API · 관리) · `app`(앱 데이터). 앱 도메인에서 여는 경로는 `HostGate.openPaths`로 등록한다 (`/api/community` 아래, `admin/`만 빼고 쓰기까지)

## 지켜야 할 것
- 회원 쿠키는 앱 도메인에서만 읽고, Domain 없이 그 도메인에만 둔다. 기본 도메인(콘솔과 같은 출처)에서는 회원 API가 없는 주소와 같다
- 회원은 권한이 없다 (`MemberActor.can`은 늘 false, 공간 없음): 다른 모듈의 읽기에는 방문자와 같다. 관리 일은 `assertOwner` 그대로
- 비밀번호는 해시(platform `PasswordHasher`)만 두고 어느 View · 로그에도 싣지 않는다. 해시를 만들고 확인하는 일은 느려서 트랜잭션 밖에서
- 로그인 실패는 늘 같은 문구 · 같은 시간 (없는 아이디도 `verify`가 가짜 값으로 같은 일을 한다): 아이디가 있는지 알려 주지 않는다
- 시도 제한(`AttemptLimiter`)은 앱 · 곳(IP, IPv6는 /64)마다 서버 메모리에서만 센다. IP · 이메일은 저장하지 않는다 (최소 수집). 앱 도메인 요청의 거절도 보안 기록(IP를 담는다)에 남기지 않는다 (3-4, platform `DomainErrorFilter`)
- 탈퇴한 회원의 지운 값(`left:<id>`)을 어느 화면에도 아이디로 보이지 않는다. 회원 쪽 데이터는 md 보관 형식에 넣지 않는다 (앱 내보내기 · DB 백업)
- 다른 모듈과는 Lookups와 이벤트로만 (나중에 진입점만 다른 컨테이너로 뗄 수 있게, 스토어 11.2)
- 앱 데이터의 SQL에는 `app_tables`에 있는 표 · 칸 이름만 쓴다 (요청의 글자를 이름으로 넣지 않는다, 값은 늘 매개변수로). 회원 쪽 쿼리는 꼭 `asMember` 안에서: 규칙을 코드의 조건으로 대신하지 않는다
- `SET LOCAL ROLE`은 API의 조건 실수를 막는 것이지 임의 SQL을 막지 못한다 (같은 연결에서 역할을 되돌릴 수 있다). 앱 코드 · 회원이 SQL을 보낼 길을 만들지 않는다
- 관리 API는 관리자 쿠키로 기본 도메인에서만 (`admin/`은 `HostGate`가 앱 도메인에 열지 않는다). 회원의 삭제 · 제재는 관리자의 결정으로만 (원칙 7 · 10): 시스템은 신고가 쌓였을 때 임시로 가리기만 한다
- 임시 비밀번호는 저장 · 로그에 남기지 않는다 (응답 한 번). 신고한 회원은 관리자에게만 닉네임으로 보인다

## 하지 말 것
- account · blog 등 다른 모듈 import, 다른 스키마에 SQL
- 관리자 쿠키를 읽거나 회원을 관리자처럼 다루기
