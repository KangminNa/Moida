# blog 모듈

## 하는 일
방문자가 읽는 스토어의 앱(블로그 · 매거진 · 페이지 앱)과 그 글 엔진. 앱, 글(판·발행), 메뉴, 매거진 호, 사진, 페이지, 소재(글을 쓰기 위한 작업대).

- `app/`: 스토어의 앱 (`App`, 스토어 1단계, [docs/스토어.md](../../../../../docs/스토어.md) 8장). 종류(blog · magazine · page, 만들 때만) · 주소(`/<slug>`, `App.checkSlug` · 못 쓰는 이름 `App.RESERVED`) · 공개 여부(비공개로 만들고 관리자만 공개) · 순서 · 설명 · 아이콘.
  `api/apps`(목록 · `by-slug/:slug` · `by-slug/:slug/icon`은 누구나 — 방문자는 공개 앱만, 만들기 · 고치기 · 지우기 · 아이콘은 관리자). 만들기 · 고치기는 `AppEdit` 한 줄을 지난다(관리자 REST · 설정 바꾸기 제안의 미리 해 보기 · 승인 뒤 적용): 만들기는 시작 메뉴(블로그: 글, 매거진: 호, 이름을 주면 그 글 목록 메뉴들)와 페이지 앱의 페이지까지 준비하고 `save`가 앱 → 메뉴 → 페이지 순서로 저장한다. 대화의 `propose_setting app`은 공개 여부를 받지 않는다 (페이지와 같다: AI · 기기가 공개하는 길은 없다).
  지우기는 글 · 페이지 · 호가 없을 때만, 빈 메뉴는 함께 지우고 페이지 앱의 페이지는 앱 밖으로 푼다. 공개 여부가 바뀌거나 지우면 `blog.app.changed`(vault의 그래프 사본, 1-2단계)
  앱별 운영 (스토어 2단계, [docs/스토어.md](../../../../../docs/스토어.md) 10장): 운영 팀장(`apps.agent_id`) · 편집 방침(`apps.policy`). 운영 팀은 팀장과 그 아래 팀 전체이고 판단은 `AppTeam` 한 곳(앱 · 메뉴가 함께 쓴다): 팀장은 맨 위의, 비공개를 읽지 않는 에이전트만(`assertLeader`, 메뉴는 깊이를 보지 않는다), 앱 · 메뉴에 글을 놓는 에이전트는 비공개를 읽지 않고 운영 팀(메뉴의 팀, 없으면 앱의 팀) 안이어야 한다(`assertWriter` · `allows`, 관리자 · 기기는 늘). 팀 안인지는 요청자의 보고 대상(platform `AgentCard.chain`, 에이전트 자신도 읽는다)으로 트랜잭션 전에 본다: `PostService`(`placeDraft` · `intoIssue`) · `MenuQuery.forTool`(`can_write`). 대화의 `propose_setting app`도 `agent_id` · `policy`를 받는다.
  방문자 첫 화면 고정(`apps.home`, 공개 앱만 · 공간마다 하나): `PUT api/apps/home`(관리자만, 공간의 앱을 모두 잠그고 푸는 것부터 저장), 비공개로 바꾸면 `App.edit`이 푼다. 대화로는 바꾸지 않는다

- `app-code/`: 앱 코드 (스토어 1-6, [docs/스토어.md](../../../../../docs/스토어.md) 9장). 앱마다 자기 코드 묶음(HTML · CSS · JS · 그림)을 버전으로 쌓는다(`AppCode`: `apps`의 코드 칸 + 추가만 하는 `app_code_versions`). 묶음 규칙은 `AppCodeBundle`(파일 규칙은 `PageFiles` 그대로 + 크기 · `cairn.json`의 바깥 주소), 코드가 없는 앱은 종류의 시작 코드(`AppStarterGateway`: 저장소 `apps/server/starters/base` 위에 종류 폴더, `AppCodeFiles.starter`).
  공개 앱의 새 버전은 확인 대기(`code_pending_seq`, `blog.app_code.added`의 `pending` → 즉시 알림), 관리자가 `show`로 공개하면 풀린다(`blog.app_code.shown`의 `settled`). 비공개 앱의 새 버전은 바로 보인다.
  대화의 make 일이 만든 확인 대기 버전은 task가 결과 카드에 공개 승인(`blog.app_code.show`, 대상 앱 · 판 = 버전)으로 싣고, 승인하면 `AppCodeShowHandler` → `AppCodeService.showApproved`(그 동작의 `ApprovedActor`만) → `AppCode.showApproved`: 아직 보이지 않을 때만 보인다 (더 새 버전이 보이면 되돌리지 않는다, 스토어 1-6b).
  관리자 `api/apps/:id/code`(코드 · 바뀐 점 · zip 받기 · zip 올리기 · 공개 · 시작 코드로 · 미리 보기 주소). AI는 만들기 작업의 `payload.appCode`로만 버전을 만든다: `task.app_code.built` → `AppCodeBuiltHandler` → `AppCodeService.built`(가장 새 버전 · 시작 코드 위에 얹기, 실행마다 버전 하나, 규칙에 맞지 않으면 `blog.app_code.refused` → 알림). MCP `app_code_base`(run, 쥔 일만): 고칠 앱의 지금 코드.
  방문자 화면은 `api/apps/site/:slug/screen`(`AppSiteQuery`: 앱 · 토큰 · 버전을 정하고 템플릿을 고른다, `AppScreenQuery`: 그 앱 안의 방문자 데이터) · `files/:name`. 볼 수 있는 앱 = 공개 앱, 또는 미리 보기 토큰(`AppTicket`, 30분, 앱 하나 · 버전 하나)의 그 앱. 그리기(Mustache)와 화면의 격리 머리글은 웹이 한다. 앱 코드는 서버에서 실행되지 않는다
- `post/`: 글(`Post` + 판 `PostRevision`), 내용(`PostContent`: 제목·본문 md, 앞부분·찾기용 글자), 주소 규칙(`SlugPolicy`).
  `api/posts`: 목록(방문자는 공개 글만, 주인은 공개 범위별 + 탭별 글 수), 주소로 열기(`by-slug/:slug`, 방문자는 공개·링크만),
  편집기용 읽기, 새 글(`requestId`로 한 번만), 고쳐 쓰기(새 판, `version`), 공개 범위(`/status`), 휴지통(`DELETE`)·되살리기(`/restore`).
  글 → wiki 연결은 `Post.linkWikis`: 새 글·고쳐 쓰기·초안 저장의 `mainWikiId`·`refWikiIds` (`blog_save_draft`는 `main_wiki_id`·`ref_wiki_ids`). 보내지 않으면 그대로, 대표 null과 참고 []는 비우기.
  MCP 도구 `blog_get_post`(휴지통 글은 없는 글과 같다. 작업 토큰에 봉인된 읽기 허락(`Actor.mayRead`, 대화의 참조 2026-11-15 B)이 있는 글은 쓰기 권한 없이도 그 작업에서 읽힌다)와 `blog_save_draft`(`PostService.saveDraft`, 주소·정렬은 건드리지 않고, 고칠 때는 `base_version`이 꼭 있어야 한다).
  결재한 공개는 `PublishApprovedHandler` → `PostService.publishApproved` → `Post.publishApproved`.
  보관 파일은 `PostArchiveQuery`: 앱 `blog/apps/<주소>.yml`(앱 하나에 파일 하나, 스토어 1-3)과 보이는 버전의 코드 `blog/apps/<주소>/code/<파일>`(이름 순서, 스토어 1-6c), 글과, 남은 글이 쓰는 사진 · 앱 아이콘 `assets/<해시>.<확장자>`(휴지통 글에만 붙은 사진은 뺀다. 디스크에 없는 파일은 로그만 남기고 뺀다). 글마다 붙은 사진은 앞부분 `cairn_assets`에, 든 앱은 `cairn_app`에 적는다. 공개 저장소로는 공개 앱과, 공개 앱에 든 공개 글 · 그 사진 · 공개 앱의 아이콘만 나간다.
  복원의 blog 몫은 `PostRestore`(`RestoredApp` · `RestoredPost`, 새 행만 넣는 `PostRestoreRepository`): 앱은 id · 종류 · 공개 여부 · 아이콘 그대로(칸은 `App.checked` · `App.checkSlug`, 버전은 1부터), 글이 없는 앱을 가리키거나 공개 · 링크 공개 글이 앱 밖이면 멈춘다. 사진은 이름의 해시와 파일의 앞부분을 확인하고, `cairn_assets`가 없는 옛 백업은 본문의 `/api/files/<해시>`로 사진 행을 만든다. 앱 코드는 `RestoredAppCode`(묶음 규칙 `AppCodeBundle`)가 읽어 그 앱의 버전 1(`restore`, `code_seq` 1)로 넣는다. 앱 파일이 없는데 공개 · 링크 공개 글이 있으면 앱이 생기기 전의 백업이라 모든 글을 기본 앱(`RestoredApp.former`: 블로그, `/blog`, 공개, id = 공간 id. vault도 같은 규칙)에 넣는다
- `asset/`: 사진(`Asset`, 글 ↔ 파일 한 행), 형식 판단(`ImagePolicy`: 파일의 앞부분으로, PNG · JPEG · WebP · GIF만).
  `POST api/posts/:id/assets`(주인만, 본문이 파일 그대로), `GET api/files/:hash?ticket=`(공개 앱의 공개 · 링크 공개 글의 사진은 누구나, 앱 코드 미리 보기 토큰(`AppTicket`)이 있으면 그 앱의 공개 · 링크 공개 글의 사진도, 스토어 1-6b). 파일은 platform의 `BlobStore`에 있다
- `basket/`: 소재(`BasketItem`, 공간마다 기본 상자 하나를 처음 담을 때 만든다). `api/basket/items`(주인만), MCP 도구 `basket_get`(write 권한).
  브라우저 확장의 "이 페이지 보관"은 MCP `keep_page`(upload 기기, 2차 4단계, `BasketService.keep`): 링크 소재 하나(`actor_type` device), 읽은 글은 비밀값을 지워 메모로, 같은 주소는 한 번(`duplicate`).
  지금은 세션·글·링크·메모만 담는다. 사진·파일은 소재용 올리는 길이 없어 받지 않는다
- `page/`: 페이지(`Page` + 판, 파일 목록 `PageFiles`, 보기 표 `PageTicket`). AI가 만든 HTML 묶음을 바깥 주소(`/pages/<이름>/`)로 내보낸다.
  만들기 작업이 끝나면 `PageBuiltHandler`(`task.page.built`) → `PageService.built`: 페이지가 없으면 만들고(이름은 `Page.nameOf(title)`, 겹치면 번호) 판을 붙여 그 판을 보이게 한다.
  `api/pages`: 목록(주인은 전부 + `lastTaskId`, 그 밖은 공개 페이지의 이름 · 제목만), 상세와 판 목록 · 제목 · 공개 범위(`PATCH`) · 보이는 판 옮기기(`/current`)는 주인만.
  바깥 주소는 `GET api/pages/site/*path`(웹이 `/pages/…`를 넘긴다, `PageQuery.site` → `PageSiteAnswer`). 시험은 task와 이어져 `src/testing/page.api.test.ts`에 있다
  자라는 페이지 (2차 5단계): 방향(`pages.direction`, 관리자만 `edit`), 있는 페이지의 새 판은 앞 판 위에 이번 파일을 얹는다(`PageFiles.overlay`, 고칠 페이지가 없는데 문이 없으면 만들지 않는다). 공개 페이지의 새 판은 확인 대기(`pending_seq`, 이벤트 `blog.page.pending` → `BlogNotices` 즉시 알림)이고 `switchTo`로 그 판(이상)을 보이면 풀린다(`blog.page.shown` → 알림 읽음). 대기 판은 판 번호를 봉인한 보기 표(`PageTicket(pageId, seq)`)로 미리 본다.
  바뀐 점 `GET api/pages/:id/revisions/:seq/changes`(`PageDataDiff`: 앞 판과 `data.json`의 잎을 비교, 주인만). MCP `page_base`(run, `page.tool.ts`): 페이지를 고치는 만들기 일을 쥔 러너만(platform `Leases`) 가장 새 판의 글 파일 · 방향을 받는다

- `menu/`: 블로그 메뉴(`Menu`, 2차 6단계, 쓰지 않던 categories를 넓힘). 앱 하나에 든다(스토어 1단계, 만들 때만, 페이지 앱에는 없다) · 종류(posts · issues · pages · page, 만들 때만) · 주소(`/<앱>/m/<주소>`, 앱 안에서 하나) · 순서 · 편집 방침 · 운영 팀 · RSS. `api/menus?app=`(목록은 누구나 — 방문자는 공개 앱의 이름 · 주소 · 종류 · 앱 주소만, 쓰기는 관리자), MCP `blog_menus`(write: 앱 · 메뉴 · 편집 방침 · 만드는 중인 호 · `can_write`, `app_id`로 한 앱만).
  운영 팀장은 이 공간의, `read_all` 없는 에이전트만: blog는 task를 모르므로 트랜잭션 전에 platform `AgentDirectory`로 묻는다. 무엇을 담는지는 `Menu.assertHolds`, 누가 올리는지는 `AppTeam`(위의 앱: 메뉴의 운영 팀은 그 에이전트와 그 아래 팀, 스토어 2단계에서 넓힘). `blog_save_draft`의 `app_id`와 `menu_id`가 다른 앱이면 `Menu.assertInApp`이 422. 담긴 것이 있으면 지우지 않는다.
  올리기: 글은 `POST api/posts/:id/menu`(관리자) · `blog_save_draft`의 `menu_id`(`Post.placeIn`), 페이지는 `PATCH api/pages/:id`의 `menuId`(`Page.placeIn`, 페이지 하나 메뉴는 메뉴를 잠가 하나만). 올린 것은 공개 대기이고 공개는 공개 범위로. 글 · 페이지 목록의 `?menu=`, 보관함 줄의 `place`. 결과 카드 전에 메뉴에 올리지 않은 글의 발행을 짚는다(platform `ActionChecks`, `PostQuery.publishProblem`)
- `issue/`: 매거진 호(`Issue`, 쓰지 않던 series를 넓힘). 호 목록 메뉴 안의 번호(메뉴를 잠가 다음 수), 글은 `posts.issue_id` · `issue_order`로(`Post.joinIssue`, 메뉴에서는 빠진다). `api/issues`(발행한 호 · `by-number/:menu/:number`는 누구나, 쓰기 · 발행은 관리자), `blog_save_draft`의 `issue_id`.
  발행은 호 전체를 한 번에: 관리자의 `publish`(못 하면 422)와 결재 동작 `blog.issue.publish`(`IssuePublishHandler` → `IssueService.publishApproved`, 결과 `blog.issue.published` · `publish_failed`, 같은 결재는 `Idempotency`로 앞 결과를 다시). 휴지통 글 · 빈 호 · 결재 뒤 바뀐 호면 아무것도 바꾸지 않는다. 결재한 공개의 요청자 · 결과는 글과 같은 `PostPublish` 정책

엔티티는 `TableEntity`(platform)로 표 한 줄을 들고, Repository(`TableRepository`)는 바뀐 칸만 저장한다 (객체설계 6장). 칼럼을 아는 곳은 `blog.tables.ts`, Entity의 `RULES`, Input의 `COLUMNS`, View의 `toJSON`, 보관·복원이다.
글의 주소·태그·정렬은 `Post.RULES`를 지나 `edit(content, changes)`로 바뀌고(주소의 모양과 겹침은 `SlugPolicy`가 먼저 본다), 공개 범위·휴지통·wiki 연결은 동사 메서드로만 바뀐다.
`Post`는 지금 판·판 수·참고 wiki를 함께 읽어(`LoadedPost`) 판과 참고 wiki를 `saveParts`로 저장하고, 같은 값은 적지 않아 바뀐 것이 없으면 버전도 그대로다. `Asset`은 id가 없어 `BaseEntity`다.
글의 View는 보는 사람마다 둘이다: 비공개까지 보는 요청자는 `PostView` · `PostPageView` · `SavedPostView`, 아니면 `Public…`(wiki 연결 없음). 읽기는 `PostQuery`가, 쓰기 결과는 `Post.view(actor)`가 고른다.

## 소유 데이터
스키마 `blog`: apps, app_code_versions(추가만), menus, issues, posts, post_revisions, assets, post_wiki_refs, pages, page_revisions(추가만)
스키마 `work`: baskets, basket_items

## 데이터 묶음
- 앱: apps (스토어 1단계. 앱과 시작 메뉴 · 페이지 앱의 페이지를 한 번에 바꾸는 `AppEdit` · `AppService`만 메뉴 · 페이지의 Repository를 함께 쓴다, `IssueService`와 같은 예외)
- 글: posts + post_revisions + post_wiki_refs
- 사진: assets
- 페이지: pages + page_revisions (파일은 platform.blobs를 값으로)
- 앱 코드: apps의 코드 칸(code_seq · code_pending_seq · code_versions) + app_code_versions (스토어 1-6. 앱 설정과 같은 줄이라 `AppCode`와 `App`이 같은 `version`을 쓴다. 버전의 `app_id`는 외래키 없는 값)
- 메뉴: menus (2차 6단계)
- 매거진 호: issues (+ 든 글의 posts.issue_id · issue_order. 호와 글을 한 번에 바꾸는 `IssueService`만 글의 Repository를 함께 쓴다, 객체설계 4장 예외)
- 소재: baskets + basket_items

## 공개 API (`index.ts`)
`BlogModule`, `BlogTools`(블로그 도구 목록, mcp 모듈이 모아서 연다)

## 내보내는 이벤트 / 받는 이벤트
칸의 원본은 `blog.events.json` (리팩토링 R3c): 여기는 뜻을 적고, 칸이 바뀌면 그 파일을 고친다. 목록에 없는 주제 · 칸은 내보낼 때 막힌다.

`blog.post.published` · `blog.post.updated` · `blog.post.unpublished` · `blog.post.deleted` (v1: postId, slug, title, status, appId, postVersion, mainWikiId, refWikiIds. vault가 글 자리 사본을 갱신한다). 임시 글은 알리지 않아 공개해야 그래프에 나온다. 공개 글이 다른 앱으로 가면 `updated`.
`blog.app.changed` (v1: appId, visibility, appVersion, deleted. 앱의 공개 여부가 바뀌거나 앱을 지울 때. vault가 그래프 사본에서 비공개 앱의 글을 숨긴다)
결재한 공개의 결과: 성공이면 `blog.post.published`에 `approvalId`·`outcome: 'done'`이 붙고(사람의 공개에는 없다), 실패면 `blog.post.publish_failed` (postId, approvalId, outcome: 'failed', error. 글 상태는 싣지 않아 사본을 고치는 데 쓰지 않는다). task가 받아 작업을 끝낸다.

`blog.page.changed` (v1: pageId, name, currentSeq, visibility. 페이지가 생기거나 판이 붙거나 보이는 판 · 공개 범위 · 제목 · 방향이 바뀔 때. 화면의 변경 신호로 쓴다)
`blog.issue.published` (v1: issueId, menuId, number, title, 결재한 발행이면 approvalId · outcome done) · `blog.issue.publish_failed` (issueId, approvalId, outcome failed, error). 결재 결과는 task가 받아 작업을 끝낸다. 호와 함께 공개된 글마다 `blog.post.published`도 난다 (approvalId 없이)
`blog.setting.changed` (v1: approvalId, outcome, error?. 승인한 블로그 메뉴 설정 바꾸기의 결과, 2026-11-15 D: `MenuEdit` · `BlogSettings`, 관리자의 만들기 · 고치기와 같은 줄. 종류는 만들 때만)
`blog.page.pending` (v1: pageId, title, seq. 공개 페이지에 확인 대기 판이 생김) · `blog.page.shown` (v1: pageId, seq. 대기 판을 보임). 받는 모듈은 없고 알림(`BlogNotices`)만 만든다
`blog.app_code.added` (v1: appId, name, seq, source, pending, taskId. 앱 코드의 새 버전, 공개 앱이면 pending → 확인 알림. AI 작업이 만든 버전이면 taskId: task가 대화의 일이면 결과 카드에 공개 승인을 싣는다) · `blog.app_code.shown` (v1: appId, seq, settled. 보이는 버전이 바뀜, settled면 확인 알림 읽음) · `blog.app_code.refused` (v1: appId, name, taskId, error. AI 작업의 결과로 버전을 만들지 못함 → 알림). `added`는 task가 받는다 (결과 카드), 나머지는 받는 모듈이 없다

받는 이벤트: `task.approval.granted` 중 `action`이 `blog.post.publish` · `blog.issue.publish` · `blog.app_code.show`(스토어 1-6b, 결과를 task에 돌려주지 않는다)인 것만 (`CoreWorkers.expect`도 여기서 적는다).
`task.page.built` (taskId, runId, pageId, title, note, files): 페이지의 새 판. 두 번 받아도 판은 하나다 (`page_revisions`의 `UNIQUE(page_id, run_id)`와 `PageRepository.hasRun`)
`task.app_code.built` (taskId, runId, appId, note, files): 앱 코드의 새 버전 (스토어 1-6). 두 번 받아도 버전은 하나다 (`UNIQUE(app_id, run_id)`와 `AppCodeRepository.hasRun`). 그사이 다른 버전이 생겼으면 409로 다시 받는다

## 써도 되는 모듈
platform. vault는 가져오지 않는다 (리팩토링 R3b): 글의 wiki · 스크랩의 세션은 platform `Lookups`의 `wiki` · `session`으로 묻는다 (`modules.json`의 lookups.asks, 경계 검사가 맞춰 봄). 거꾸로 앱 이름은 `Lookups`의 `app`으로 준다 (스토어 2단계, `AppQuery.names`: 관리자는 공간의 앱, 그 밖은 공개 앱. task가 대화의 앱을 확인한다)

## 지켜야 할 것
- 글 → wiki 연결은 blog가 값으로 갖는다 (외래키 없음): 대표 `posts.main_wiki_id`, 참고 `post_wiki_refs`. 발행·수정 때 이벤트로 vault에 알린다
- 이을 wiki는 트랜잭션을 열기 전에 `Lookups.assertVisible('wiki', …)`로 확인한다. 볼 수 없는 wiki는 없는 wiki와 똑같이 404. 연결은 판을 쌓지 않지만 `version`을 올린다 (사본은 `postVersion`이 더 큰 이벤트만 받는다)
- 한 번의 저장에 공개 글의 이벤트는 하나다: `edit` 뒤에 `linkWikis`를 불러 마지막 모습을 싣는다 (`Post.announceUpdate`). 같은 `postVersion`의 뒤 이벤트는 사본이 버린다
- wiki id는 진짜 id라 UUIDv7의 날짜가 드러난다. 방문자 응답에 넣지 않고, 비공개를 볼 수 없는 요청자에게는 볼 수 있는 wiki만 준다
- 방문자 응답에는 공개된 wiki·세션의 정보만 나온다. 비공개면 자리만
- 세션 첨부를 사진으로 쓸 때는 vault Query로 파일 해시를 받아 blog의 `assets`로 복사한다
- 판(post_revisions)은 추가만 한다. 제목·본문이 바뀔 때만 새 판, 주소·태그·정렬·공개 범위는 글에 둔다
- 공개 범위: 임시(draft) · 공개(published) · 링크만(unlisted). 방문자 목록에는 공개 글만, 주소로는 공개·링크만. 임시·휴지통 글은 방문자에게 404
- 방문자에게 보이는 것은 앱도 공개여야 한다 (스토어 1단계): 글 · 메뉴 · 호 · 사진은 든 앱이 공개, 페이지는 앱 밖이거나 앱이 공개. 각 Query의 방문자 조건(`a.visibility = 'public'`)이 거른 뒤에 세고, 아니면 없는 것과 같은 404. 앱에 없는 글은 공개 · 링크만으로 바꾸지 못한다 (`Post.changeStatus` · `PostPublish.problemOf` + DB CHECK). 메뉴 · 호에 올린 글은 그 메뉴의 앱에 든다 (`Post.placeIn` · `joinIssue` + DB 외래키 `(menu_id, app_id)`)
- 공개 범위 바꾸기·휴지통·공개된 글 고치기(wiki 연결 포함)는 주인만 (`Post`가 막는다). AI 도구의 글쓰기 권한은 임시 글까지
- 주인이 아닌데 공개하는 길은 `Post.publishApproved` 하나다: `action`이 `blog.post.publish`인 `ApprovedActor`만 받고 공개만 한다
- 결재한 공개는 올린 버전과 지금 버전이 같을 때만 한다. 같은 결재가 다시 오면 `platform.idempotency`에 남긴 첫 결과를 그대로 다시 낸다 (공개 뒤에는 버전이 달라 다시 판단하면 실패가 된다). 대상이 없어도 실패를 내야 작업이 끝난다: 예외로 던지면 일꾼이 되풀이하다 멈추고 작업은 끝나지 않는다
- AI 도구의 초안(`saveDraft`)은 제목 · 본문의 비밀값을 판이 되기 전에 지운다 (platform의 `SensitivePolicy`). 주인이 편집기로 쓴 글은 지우지 않는다 (사람이 정한 것)
- 기기와 에이전트가 쓴 판의 `actor_type`은 `ai`. `request_id`는 AI가 만들어서 에이전트는 작업마다 따로 센다
- 사진의 공개 여부는 파일이 아니라 그 파일이 붙은 글로 정한다: 공개·링크 공개 글 하나에라도 붙어 있으면 누구나, 나머지는 주인만. 임시·휴지통 글의 사진은 방문자에게 없는 파일과 똑같이 404
- 파일은 트랜잭션 밖에서 쓴다. 파일이 먼저고 행이 나중이다. 행 없이 남은 파일은 다시 올리면 그대로 쓰인다
- 파일을 가리키는 칸(`assets` · `posts.cover_blob_hash` · `basket_items`)은 `BlobStore.registerUse`로 등록해 둔다 (`AssetQuery` · `BasketQuery`의 `usedBlobs`). 새 칸을 만들면 함께 등록한다: 빠뜨리면 platform이 그 파일을 지운다
- 페이지의 파일은 AI가 만든 것이라 믿지 않는다. 바깥 주소의 답에는 늘 격리 머리글을 붙인다 (`PageSiteAnswer.CSP`: `sandbox`에 `allow-same-origin`을 넣지 않는다. 넣으면 페이지의 스크립트가 주인의 로그인으로 API를 부른다). 형식은 파일 이름의 확장자로만 정하고 `nosniff`
- 앱 코드는 사람이 올리거나 AI가 만든 것이라 믿지 않는다 (스토어 1-6). 서버는 템플릿 · 파일을 실행하지 않고 내보내기만 하며, 파일의 답에는 늘 격리 머리글(`PageSiteAnswer.CSP`)을 붙인다. 템플릿(.html)은 파일로 내보내지 않는다. 방문자 화면의 데이터는 누가 보든(관리자 · 토큰도) 방문자 데이터다: 초안은 미리 보기에도 없다
- 페이지는 비공개가 기본이다. 방문자와 기기에게 비공개 페이지는 없는 페이지와 똑같이 404이고, 공개는 주인의 `edit`만 한다 (AI · 기기가 공개하는 길은 없다)
- 격리된 페이지 안에서는 쿠키가 실리지 않는다. 비공개 페이지의 딸린 파일은 보기 표(`PageTicket`, 서버 키로 봉인, 30분, 그 페이지 하나)가 든 주소로 받는다. 표 주소는 `no-referrer`로 밖에 실리지 않게 한다 (격리된 페이지는 애초에 Referer를 보내지 않는다. 브라우저로 확인. 머리글은 격리를 모르는 브라우저에 대비해 둔 것이다)
- 판(page_revisions)은 추가만 한다. 되돌리기는 `current_seq`를 옮기는 것이다. 판이 가리키는 파일은 `BlobStore.registerUse`(`PageQuery.usedBlobs`)로 지켜서, 결과물을 지워도 페이지는 남는다
- SVG는 스크립트를 담을 수 있어 받지 않는다. 형식은 요청 머리글이 아니라 파일의 앞부분으로만 정한다
- 소재에는 비공개 자료가 담긴다. REST는 주인만(`assertOwner`, write 권한 기기도 안 된다), MCP는 write 권한으로만 읽는다. 기기가 담는 길은 `keep_page` 하나(upload, 링크만). 링크는 http·https만
- 세션·글을 담을 때는 트랜잭션을 열기 전에 Query로 있는지 확인한다
- 방문자는 공간을 모른다: MVP는 공간 하나라 방문자 읽기는 공간으로 거르지 않는다 (공간이 여럿이 되면 Guard가 주소로 정한다)

## 하지 말 것
- vault의 Service 호출이나 vault 테이블 SQL 접근 (읽기는 vault Query로만)
- vault와 한 트랜잭션에 묶기 (복원만 예외다: platform의 `ArchiveRestoreService`가 트랜잭션을 열고, blog는 자기 스키마에만 쓴다)
