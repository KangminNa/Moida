# 플러그인

코어가 몰라도 되는 기능은 플러그인으로 만든다 (기획서 결정 기록 2026-10-10, 객체설계 12장).
지금 있는 플러그인: `comments-giscus`(글 아래 giscus 댓글), `sync-github`(보관 형식을 GitHub에 동기화), `login-github`(GitHub 계정으로 로그인), `office`(콘솔의 픽셀 사무실), `browser-tabs`(서버 브라우저, 기능 패키지), `code-github`(코드 작업을 GitHub와 잇기, 기능 패키지), `map`(지도 API 등록 · 장소 · 주소 찾기: 앱 코드의 `moida.map`이 쓴다, 회사 정보는 `providers.json`, 찾기는 서버 키로 `/api/p/map/…`, 콘솔 › 운영 › 지도에 오늘 찾기 횟수 · 한도, 일꾼 도구 `map_geocode`(주소 확인, `AGENT_OUT`), docs/지도.md), `messenger-telegram`(텔레그램 봇으로 대표와 대화, 기능 패키지, 대화 입구 `uses: chat`), `email`(콘솔의 알림과 "메일로 받기"를 켠 자동화의 결과를 관리자 메일로 · 방문자의 앱 소식 구독(스토어의 `store.after`, 두 번 확인, 관리자가 보내기) · 코어의 인증코드 메일(`uses: mail`, `provideMail`) · 메일 사용량과 하루 · 한 달 상한(`email.usage`), SMTP 465, docs/이메일.md).

## 폴더 하나 = 플러그인 하나

```
plugins/<이름>/
  moida-plugin.json     목록 파일. 여기에 적은 것만 쓸 수 있다
  web/<화면>.tsx         웹 화면 자리에 들어갈 화면 (있을 때만)
  server/plugin.ts      서버 코드 (있을 때만). BasePlugin을 상속한 클래스를 default로
  server/*.test.ts      테스트 (pnpm test가 함께 돌림)
```

## 목록 파일

- `name`: 폴더 이름과 같아야 한다. 소문자·숫자·하이픈
- `version`: 1.2.3, `moida`: 지원하는 플러그인 API 범위 (지금은 `">=0.1"`)
- `settings`: 설정 항목. `label`, `type`(`text`·`secret`·`select`·`boolean`), `required`, `help`, `default`, `options`(select), `public`.
  설치 마법사·관리 화면의 칸이 이것으로 만들어진다. 값은 DB(`platform.plugin_settings`)에 저장되고, `secret`은 서버 키로 암호화된다.
  `public: true`인 값만 웹으로 내려간다 (비밀값은 공개할 수 없다)
- `guide`: 쉬운 말 안내 (2026-11-26). `does`(하는 일) · `setup`(설정 순서), 한 줄 300자 · 12줄까지. 콘솔의 플러그인 카드에 보이고, 켜면 허락하는 기술 목록(`uses`)은 "자세히"로 접힌다. 새 플러그인은 꼭 적는다
- `web`: 화면 자리 → 파일. 지금 자리는 `post.after`(글 아래), `task.office`(콘솔의 오피스), `store.after`(스토어 화면 아래: 공개 앱의 주소 · 이름, 메일 링크의 `mail` · `token`)
- `server`, `uses`: 서버 코드와 쓰는 확장 지점 (`event:<무늬>`, `job:<이름>`, `action:<이름>`, `archive:read`, `archive:restore`, `login:<이름>`, `delegate:<대상 종류>`). 객체설계 12장

## 켜기·설정

설치 마법사와 관리 화면(설정 → 플러그인)에서 켜고, 쓰는 권한을 확인하고, 설정 칸을 채운다. 화면이 생기기 전에는 명령줄:

```
pnpm plugin                                   들어 있는 플러그인과 상태
pnpm plugin enable sync-github                켜기 (쓰는 권한을 보여주고 허락)
pnpm plugin set sync-github repo me/archive   값 넣기
echo -n "<토큰>" | pnpm plugin set sync-github token   비밀값은 표준 입력으로
pnpm plugin sync-github check                 관리 동작
```

- `.env`에는 플러그인 설정을 두지 않는다. 서버 키(`MOIDA_SECRET_KEY`, `pnpm secret:new`)만 둔다.
- 켜진 플러그인의 비밀이 아닌 설정은 대화에서도 바꾼다 (2026-11-15 D, `propose_setting { setting: plugin, target_name }` → 승인 → `PluginEdit`). 비밀 칸과 켜고 끄기는 화면 · 명령줄에서만. 승인 화면에서 플러그인 설정의 줄은 모두 굵게 보인다 (바깥으로 보내는 곳이 많다)
- 켜고 끄거나 설정을 바꾸면 재시작 없이 반영된다 (`platform.plugin.changed` 이벤트 → 일꾼이 다시 등록, 서버는 매번 DB에서 읽음).
- 웹은 들어 있는 플러그인 화면을 모두 넣어 두고, 켜진 것만 그린다.
- **새 플러그인 폴더를 넣었을 때만** 서버·일꾼·웹을 다시 시작한다 (들어 있는 플러그인 목록은 시작할 때 읽는다).
- 새 버전이 확장 지점을 더 쓰면, 다시 켜서 허락하기 전까지 그 플러그인은 동작하지 않는다.
- 켰는데 서버 코드를 불러오지 못하면(문법 오류 · `register`의 오류 · 겹친 로그인 방법) 그 플러그인만 멈추고 서버는 계속 돈다. 목록(`GET /api/plugins`의 `active: false` · `problem`, 설정 › 플러그인의 "동작하지 못함", `pnpm plugin`의 "켜짐 (동작하지 못함)")에 이유가 보이고, 방문자 목록 · 콘솔 메뉴에서는 빠진다 (2026-11-20). 경로가 모두 404면 여기부터 본다. 고친 뒤에는 다시 켜거나 서버 · 일꾼을 다시 시작한다

## 지켜야 할 것

- 웹 화면은 `react`와 자기 폴더 안의 파일만, 서버 코드는 `node:*`와 `apps/server/src/plugin-api`만 import한다 (`pnpm check`가 막는다)
- 외부 서비스 호출은 `BaseGateway`를 상속한 클래스 하나에 모은다. 테스트는 가짜 서버로 (예: `sync-github/server/fake-github.ts`)
- 화면이 받는 값은 `settings`(공개 설정)와 `context`(자리마다 정해진 값, `post.after`는 글 id·주소·제목)뿐이다
- 설정이 비어 있으면 방문자에게는 아무것도 보이지 않게 한다 (`context.preview`일 때만 안내)
- 로그인 플러그인은 "누구인지"만 알려준다. 주인인지는 코어가 정하므로, 주인이 계정 화면에서 연결한 계정으로만 로그인된다
- 기능 패키지(자기 표 · API · MCP 도구 · 콘솔 메뉴)는 아래 "기능 패키지"를 따른다

## 기능 패키지

코어를 고치지 않고 자기 표 · API · MCP 도구 · 콘솔 메뉴를 갖는 플러그인. 예: `browser-tabs` (기능 문서 [docs/브라우저.md](../docs/브라우저.md)). 구조와 코어가 하는 일은 객체설계 12장.

```
plugins/<이름>/
  moida-plugin.json     "schema", "api", "tools", "menu" + uses: table · api · tool:<이름> · menu · task:request
                        (러너가 몇 초마다 묻는 도구는 "polled": true: 성공한 부름은 서버 요청 로그에 남기지 않는다)
  migrations/           <시각>_<이름>.sql (dbmate). 자기 스키마만 만들고 바꾼다
  server/plugin.ts      register(moida)에서 moida.addOperation(new XxxRead())
  server/operations.ts  Read · Command (plugin-api)
  server/views.ts       toJSON (콘솔 camelCase, MCP snake_case)
  server/tables.ts · schema.ts   pnpm db:rows가 만든다. 고치지 않는다
  web/<화면>.tsx         콘솔 화면. props로 call(method, path, body) · notify(text). call은 패키지 경로, '/api/'로 시작하면 코어의 읽기(GET)만
```

- 표는 자기 스키마(`schema`)에만. 코어 표를 읽거나 쓰지 않고 외래키도 걸지 않는다 (`space_id`는 값으로). `Work`가 다른 스키마의 표를 막고, `pnpm check`가 `work.sql`의 스키마를 본다
- 동작의 `allow`: `Operation.OWNER`(주인만), `Operation.ANYONE`(방문자도), 또는 `Actor.RUN` 같은 권한. 관리 일은 늘 `Operation.OWNER`. 입력이 바깥 사이트로 나가는 에이전트 도구는 `Actor.AGENT_OUT`(에이전트만, 기기는 안 된다. 2026-11-21부터 모든 에이전트가 비공개도 읽는 같은 일꾼이라 에이전트면 모두 통과한다, `browser-tabs`의 `site_run`)
- 입력은 `this.fields(raw, (f) => …)`로 읽는다 (틀린 칸을 모아 400). 뜻의 검사는 `run`에서 `RuleViolation`
- 목록 파일의 `api` · `tools`가 가리키지 않는 동작은 등록되지 않는다. 도구 입력 모양(`tools.<이름>.input`)을 바꾸면 쓰는 스킬 · 러너도 함께 고친다 (`browser-tabs`의 러너 쪽은 `apps/runner/src/tab-reader.ts` · `browse-stage.ts` · `browse-login.ts` · `click-runner.ts` · `stop-hold.ts` · `press-loop.ts` · `press-calls.ts` · `login-runner.ts` · `login-calls.ts` · `moida-server.ts` · 사이트 도구의 `site-tool-calls.ts` · `site-build.ts` · `integration-runner.ts`, 스킬 `moida-browse`, 지시문 틀 `site-build`)
- 관리자의 대화에 말을 넣으려면 `uses`에 `chat`을 적고 쓰기 동작에서 `work.sendChat(공간, 대화 id 또는 null, requestId, 글)` (플러그인 API 0.10): 콘솔에서 보낸 말과 같다 (덧붙인 말 · 새 대화 · 같은 requestId는 한 번). 누가 보낸 말인지(관리자가 이어 둔 계정인지)는 패키지가 확인한다. 대화의 답은 `task.chat.said`(최종 답 · 덧붙인 말의 답 · 실패)로 받는다 (`messenger-telegram`)
- 러너가 부르는 도구를 그 러너가 쥔 일에 묶으려면 `work.leased(id)` (플러그인 API 0.3): 코어가 임대를 확인하고 일의 id · 종류 · 입력(`LeasedWork`)을 준다. 0.4부터 일의 대상(`targetKind` · `targetId` · `targetVersion`), 0.5부터 지시(`instruction`), 0.7부터 관리자가 쓴 지시(`ownerText`: 위임된 일이면 맨 위 일의 제목과 지시, `read_url`의 기준과 같은 글)도 준다. 쥐고 있지 않으면 거절한다 (`code-github`의 `code_credential` · `code_pull_opened`, `browser-tabs`의 `browser_job` · `browser_click_hold` …)
- 에이전트의 위임을 대상 종류로 먼저 보려면 `moida.guardDelegate('<대상 종류>', new XxxGuard())` (플러그인 API 0.9, 읽기 동작 `Read`, 맡기는 에이전트의 자격): `RuleViolation`을 던지면 그 글로 위임이 거절된다 (`browser-tabs`의 `GuardSiteDelegation`: 켜진 사이트 도구가 있는 사이트의 browse는 도구를 써 본 뒤에만)
- 반복 작업이 바깥에 보내고 결과를 적으려면 `run(own)`의 `own('동작', 입력)`으로 자기 동작(`Operation.SYSTEM`, `api`에 없어도 된다)을 부른다 (플러그인 API 0.13, `email`의 `deliver`: 잡기 → SMTP → 적기). 공개 앱의 이름 · 주소 → id · 바깥 주소는 `work.lookup('app' | 'app-id' | 'app-url', …)` (`uses`의 `lookup:<종류>`). 소식 메일에 동의한 계정의 메일은 `work.lookup('news-address', [계정 id])`: 서버 자신의 동작(이벤트 · 반복 작업)에서만 된다 (플러그인 API 0.15, `email`). 이벤트 처리기(`BaseHandler`) · 확인 메일(`BaseMailer`) · 관리 동작도 `register`에서 받은 `moida.own()`으로 같은 길을 쓴다 (플러그인 API 0.16, `email`의 `MailGate`: 보내기 전에 사용량을 세고 한도를 본다)
- 이벤트를 받아 표에 쓰거나 이벤트를 남기려면 `moida.onEvent(무늬, new XxxCommand())`: `allow = Operation.SYSTEM`, 코어가 트랜잭션 하나에서 돌린다 (처리기 `BaseHandler`는 DB에 쓸 길이 없다)
- 이벤트는 `plugin.<스키마>.<무엇>` 이름으로만 남긴다. 에이전트에게 일을 맡기려면 `uses`에 `task:request`를 적고 `task.task.requested`를 남긴다 (그 밖의 코어 이벤트는 `work.record`가 막는다)
- 마이그레이션은 배포 때 코어와 함께 적용된다 (`docker compose`의 migrate가 `plugins/*/migrations`도 읽는다. 테스트 DB와 `pnpm db:rollback`도 같다). 마이그레이션 뒤 `pnpm db:rows`
- 콘솔 화면은 react와 자기 `web/` 폴더만 가져온다 (웹으로 복사되므로 `server/`를 가져오지 않는다). 서버가 내보내는 모양은 화면 안에 타입으로 적는다
