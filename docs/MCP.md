# MCP 먼저와 통합 굳히기

에이전트가 정보를 찾거나 일할 때 **붙은 MCP 도구를 먼저** 쓰고, 반복되는 브라우저 일은 **통합**(Playwright 코드 + 입출력 형식)으로 굳혀 AI 없이 돌린다.
결정은 [기획서](기획서.md) 12장 2026-11-15 "MCP 먼저와 통합 굳히기". 서버 브라우저는 [브라우저](브라우저.md), 커넥터(원격 MCP)는 2차 7단계(task 모듈 `external-tool/`).

## 1. 하는 일

```
일이 들어옴 ─▶ 맞는 통합 · 커넥터(MCP 도구)가 있나?
  ├ 있음 ─▶ MCP 도구 (통합이면 AI 없음, 몇 초)
  │          ├ 성공 → 끝
  │          └ 실패 → 이번 일은 서버 브라우저가 대신 → 통합에 "고장" → 고치기 제안
  └ 없음 ─▶ read_url (공개 페이지 하나) 또는 서버 브라우저 (AI가 직접, 지금 방식)
             └ 같은 일이 되풀이되면 → "도구로 굳힐까요?" → 승인 → 굳히기 일
```

| | 서버 브라우저 | 통합 |
|---|---|---|
| 일하는 방식 | AI가 매번 화면을 보고 클릭 | AI가 한 번 코드로 굳히고, 그다음은 코드가 실행 |
| 남는 것 | 답 · 단계 화면 | 입출력 형식이 정해진 MCP 도구 (다른 에이전트도 부른다) |
| 맞는 일 | 처음 하는 일, 가끔 하는 일, 모양이 매번 다른 일 | 같은 모양으로 되풀이하는 일 (매일 확인, 매주 받기, 같은 양식) |
| 사이트가 바뀌면 | AI가 적응 | 깨짐 → 브라우저가 대신하고 다시 굳힌다 |

## 2. 참고한 것: Pomerado

[Pomerado](https://github.com/Pomerado/pomerado) (MIT, 0.4.0, 2026-11 읽음): 말로 적은 일을 받아 AI가 실제 Chromium으로 사이트를 탐색하며 Playwright 코드를 쓰고("mint"), 저장한 코드를 MCP stdio 서버로 돌린다.

- 만들기: 작업 공간(`src/` · `explore/` · `test/` · `scratch/`)과 도구 12개(`execute` · `read_source` · `live_tests` · `request_input` · `finish_build` …). 20분 · 모델 호출 512번. 읽기는 예시 → 일반화 → AI가 설계한 시험 사례 70% 통과(`reviewPassPercent`). 쓰기는 한 번만 실제로 하고(`writePath` · `enteringCommit`) 그 걸음을 이어 붙여 굳히며 다시 돌리지 않는다. 결과 검토 AI가 됨 · 안 됨 · 모름을 정하고 됐을 수 있는 쓰기는 세 겹으로 막는다
- 코드 모양: `defineOperation({ input, output, questions?, write? }, async (ctx) => …)`, 브라우저 일은 Playwright 코드 글자를 `kernel.browsers.playwright.execute`로
- 안전: Guardian(두 번째 모델)이 실행 · 질문 · 범위 변경 · 발행을 검토한다. 믿는 입력(요청 · 답 · 허용 사이트)과 믿지 않는 입력(페이지 · 결과)을 나눠 주고, 정책 일부는 OpenAI Codex(Apache-2.0)에서 왔다. 모델 없이 도는 검사: 저장 파일의 키 모양(`sk-` · `ghp_` · `AKIA` …), 로그인 값은 허용 출처의 칸에만 한 글자씩, 비밀값은 `{{secret.sN}}`로만, 기록의 비밀값은 여러 인코딩까지 `[private]`
- 실행: 호출마다 새 Chromium · 빈 컨텍스트, 스크립트는 환경변수 없는 자식 프로세스(코드에 "OS 격리가 아님"), 로그인은 순서만 저장하고 값은 호출마다 묻는다. 작업은 메모리에 하나씩, 20초 기다리고 job id
- 묶임: 만들기 · Guardian · 결과 검토가 `@openai/agents`와 OpenAI 모델(`gpt-6.1-sol` · `gpt-6-luna`)에 묶여 있다

**그대로 넣지 않는다.** OpenAI 키가 필요하고, 만들기가 Cairn의 러너 · 승인 밖에서 돌고, 격리는 쓰는 쪽 몫이며, 변경이 잦다(0.4). 대신 설계를 가져와 Cairn식으로 만든다.

| 가져온다 | Cairn식으로 바꾼다 |
|---|---|
| 결과물 = Playwright 코드 + 입출력 형식, 실행에 AI 없음 | 만들기는 Claude 러너의 일 (원칙 6) |
| 예시 → 일반화 → 시험 70% | 검토는 검토자 짝(다른 AI 도구) + 규칙 검사 + 관리자 승인 (Guardian의 걸음마다 검토 대신) |
| 쓰기는 한 번, 저장 표시와 됐는지 확인, 반복 막기 | 쓰기 통합의 호출은 입력을 보인 승인 뒤 한 번 (원칙 7, 승인 id로 한 번) |
| 비밀값 가리킴 · 로그인 출처 검사 · 키 모양 검사 | 로그인은 서버 브라우저의 유지 프로필 (호출마다 묻지 않는다) |

작은 조각(출처 검사, 키 모양 목록, SDK 모양)을 옮길 때는 출처를 적는다 (MIT, Codex에서 온 정책 글은 Apache-2.0).

## 3. 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | MCP 먼저: 커넥터 연결 확인 · 도구 목록 · 사용 기록, 지시문의 순서(MCP 도구 → `read_url` → 브라우저), 커넥터 화면 | 끝남 (아래 5장) |
| 2 | 읽기 통합: 굳히기(관리자가 누름) · 시험 · 검토 · 켜기 승인 · 브라우저 러너에서 실행 · 실패하면 브라우저가 대신 | 코드 끝남, DB 시험 남음 (아래 6장) |
| 3 | 쓰기 통합(승인 뒤 한 번) · 되풀이 알아채고 제안 · 고장 고치기(새 버전, 앞 버전 남김) | 코드 끝남, DB 시험 남음 (아래 7장) |

## 4. 통합의 흐름 (2 · 3단계, 이름은 정할 때 바뀐다)

- 저장: `browser-tabs` 패키지의 통합 표. 사이트 · 이름 · 설명 · 읽기/쓰기 · 입출력 형식 · 코드 · 버전(추가만) · 상태(초안 · 켜짐 · 고장) · 시험 결과 · 성공/실패 수
- 보이기: 켜진 통합의 목록(`site_tools`)과 부르기 하나(`site_run`). 통합마다 도구를 만들지 않는다 (6장의 결정). 커넥터와 같은 규칙(비공개 · 셸 권한 에이전트에게는 주지 않는다)
- 실행: 서버 브라우저 러너. 코드는 격리한 자식 프로세스에서 페이지에만 닿고, 나가는 길은 그 사이트의 허용 출처만. 로그인은 유지 프로필, 풀려 있으면 지금의 "로그인 필요" 승인
- 굳히기: 계기는 관리자의 "이 일 도구로 만들기" 또는 같은 레시피 · 사이트의 브라우저 일이 되풀이될 때의 제안. 칸 러너 + 서버 브라우저에서 Claude가 앞선 브라우저 기록을 힌트로 코드를 쓰고, 예시 · 시험(70%) · 규칙 검사 · 검토자 짝을 지나 초안이 되며, 켜기는 승인
- 고장: 연속 실패면 고장으로 두고 목록에서 뺀다(브라우저가 대신). 실패 화면을 힌트로 다시 굳히기를 제안한다

## 5. 1단계: MCP 먼저 (2026-11-15)

```
관리자 "연결 확인" · 일꾼의 마감 작업(확인 전 · 고친 뒤 · 하루 지남, 커넥터를 저장하거나 확인 작업이 끝나면 다시 잰다)
  → 작업 tool_check (에이전트 없음, 도구 하나)
  → 러너 ToolCheckRun: initialize → initialized → tools/list (AI 없음, 15초 · 1MB · 넘기기 안 따라감)
  → submit_result { tools } 또는 실패 까닭 → 서버가 커넥터에 catalog · checked_at · check_error

에이전트의 일 → next_jobs tools[].catalog → 지시문 "MCP 도구 → read_url → 브라우저"
  → CLI가 도구를 고른다 (Claude mcp.json + --allowedTools mcp__x-<이름>__*, Codex config.toml [mcp_servers.x-<이름>])
  → 러너가 부름 · 실패를 센다 (Claude tool_use / is_error인 tool_result, Codex mcp_tool_call)
  → submit_result { connector_calls } → 서버가 last_used_at · last_failed_at · last_error
```

- 서버는 원격 MCP에 붙지 않는다(SSRF). 확인도 러너의 일이다
- 화면: 설정 › 커넥터. 상태(연결됨 · 연결 실패 · 확인 전 · 확인 중 · 토큰 필요 · 꺼짐 · 제안), 도구 N개(펼침), 마지막 확인 · 사용 · 오류, "연결 확인"
- 확인 일은 `next_jobs`에 `connector_check: true`를 알린 러너에게만 준다. 옛 러너만 있으면 확인은 "확인 중"으로 기다린다. 그래도 목록 칸 없이 끝난 확인은 실패로 적는다 ("러너를 새 버전으로")
- 사용 기록은 새 러너가 돈 일에서만 쌓인다. 서버 러너는 compose가 저장소로 다시 만들 때, 내 컴퓨터 러너는 `git pull` 뒤 `pnpm runner start`로 새로 띄울 때 새 버전이 된다

## 6. 2단계: 읽기 통합 = 사이트 도구 (2026-11-16)

화면 말로는 "사이트 도구"다. `browser-tabs` 0.5.0이 갖는다 (코어는 `Actor.AGENT_OUT` 하나만 더했다).

```
[굳히기] 관리자: 브라우저 › 사이트 도구 › 도구 만들기 (사이트 · 이름 · 설명 · 힌트, 끝난 브라우저 일에서 힌트 가져오기)
  → 도구(building) + browse 작업 하나 (대상 browser_integration)
  → 서버 러너: browser_job에 build 몫 → AI(Claude)가 Playwright MCP로 둘러보고 site-tool/의
     tool.json(입출력 형식) · code.js(본문) · tests.json(3~10개)을 쓴다 (셸 없음, 코드는 못 돌림)
  → 러너(AI 없음)가 시험을 하나씩 돌린다 → site_build_save → 서버가 형식으로 채점해 새 버전으로 남긴다
      70% 이상 → review + 켜기 결재(browser.integration.enable, 러너가 작업 토큰으로) → 승인하면 on
      70% 미만 → 첫 회차는 일을 돌려준다(release): 다음 회차가 틀린 시험을 힌트로 받아 고친다. 두 번째도 못 넘으면 실패 → off

[쓰기] 에이전트(비공개를 읽거나 쓰지 않는 에이전트, Actor.AGENT_OUT)
  → site_tools → site_run { request_id, name, input } (입력을 형식으로 검사, 대기열 20개)
  → 서버 러너 IntegrationRunner: site_run_next → IntegrationExec(AI 없음) → site_run_save (답을 형식으로 검사)
  → site_result { run_id } (최대 20초 기다림). 실패면 fallback: browse로 맡기기
  → 연속 3번 실패(로그인 · 러너 멈춤 · 끔은 빼고) → broken: 목록에서 빠지고 관리자가 고치기
```

- 표: `browser_tabs.integrations`(도구 · 상태 · 켜진 버전 · 집계) · `integration_revisions`(버전: 형식 · 코드 · 채점한 시험, 고치지 않음) · `runs`(실행, 30일 뒤 지움)
- 실행(`IntegrationExec`): 자식 node 프로세스. 빈 환경 변수, `--permission`으로 파일 읽기는 playwright-core와 일마다 만드는 빈 폴더만 · 쓰기는 그 폴더만 · 자식 프로세스와 worker는 막음. 지금 브라우저(CDP)의 기본 컨텍스트(유지 로그인)에 새 탭 하나, 그 탭의 문서 이동은 허용 출처의 GET만(읽기). 코드는 vm의 빈 맥락에서 `page · input · site`만 받는다. 60초(시험 45초)를 넘기면 끄고 탭을 닫는다
- 규칙 검사(`IntegrationRules`): 모듈 · 프로세스 · 전역 · 다른 탭 · 컨텍스트 · 요청 API · 쿠키 · 다운로드에 닿는 이름, 글자로 칸에 닿기, `\u` · `\x` 이스케이프, 키 모양 글자. 시험과 실행마다 돌리기 전에 본다
- 남는 위험: OS 격리가 아니다. 네트워크는 권한 모델이 막지 못하고, `page.evaluate` 안의 페이지 스크립트는 브라우저가 닿는 곳에 닿는다. 그래서 규칙 검사 · 빈 맥락 · 관리자 승인(코드를 보고 켠다)을 겹친다. 쓰기는 3단계에서 호출마다 승인으로

설계(5장 전 2026-11-15 안)와 달라진 것:
- 도구 이름: 통합마다 `site_<이름>`이 아니라 `site_tools` + `site_run` 하나. 플러그인 도구 이름은 목록 파일에 고정이라 통합마다 도구를 만들려면 코어가 도구를 그때그때 등록해야 하고, 통합이 늘수록 AI가 읽을 도구 목록도 길어진다
- 검토자 짝(다른 AI 도구의 검토)은 3단계(쓰기 통합)로 미뤘다. 읽기는 규칙 검사 + 시험 70% + 관리자 승인으로 충분하다고 봤다
- "한 번 더 고침"은 같은 실행 안의 두 번째 AI가 아니라 일을 돌려주는 것(release)으로: 다음 회차가 앞 버전 · 틀린 시험을 `browser_job`의 build로 받는다
- 켜기 결재를 올릴 수 없는 에이전트(승인 동작에 `browser.integration.enable`이 없음)가 굳힌 도구는 관리자가 화면에서 켠다. 팀 템플릿의 브라우저 담당에는 넣었다

## 7. 3단계: 고장 자동 고치기 · 되풀이 알아채기 · 쓰기 도구 · 검토자 짝 (2026-11-16)

`browser-tabs` 0.6.0. 코어는 플러그인 API 0.5(`LeasedWork.instruction`) 하나.

```
[고장 자동 고치기] 연속 3번 실패 → broken → (설정 autoRepair, 기본 켬) 하루 한 번 처음 굳힌 에이전트에게 다시 굳히기
  (요청 id repair:<도구>:<날짜>, 힌트는 최근 실패 5개, 앞 버전은 남음) → 고친 버전은 켜기 승인으로

[되풀이] 사이트 일을 빌릴 때(browser_job) 지시의 열쇠(소문자 · 따옴표 안 · 숫자 → #, 공백 하나로 → sha256)를 남긴다
  → 같은 사이트 · 같은 열쇠가 14일 안에 3번 → 제안 (사이트 · 열쇠마다 하나) → 화면의 "되풀이되는 일"
  → "도구로 만들기"(폼을 채움, 만들면 made) · "그만 보기"(dismissed, 다시 내지 않음)

[쓰기 도구] 만들 때 mode: write + 검토자(굳힌 에이전트와 다른)
  굳히기: 코드의 마지막 쓰기는 site.commit(locator) 정확히 한 번 (규칙 검사). 시험은 마른 실행:
    commit 앞에서 대상이 하나 · 보임 · 누를 수 있음만 보고 멈춤 → 답은 채점하지 않음
  70% 이상 → reviewing → 검토 일(담당 검토자) → site_review_get · site_review
    pass → review + 답의 켜기 결재를 검토자가 올림 → 승인하면 on
    fix → 의견을 힌트로 한 번 다시 굳힘 (앞 버전도 fix였으면 off)
  부르기: site_run → held + 결재 모양 → 에이전트가 request_approval(browser.integration.write, 대상 browser_run)
    → 승인 → queued → 러너가 한 번 실행 → run_done(approvalId · outcome)으로 작업이 끝남
    수정 요청 · 반려 → dropped. 실행 중 러너를 잃으면 다시 하지 않고 unknown → 관리자가 "됐어요 / 안 됐어요" 기록
  실행 중 막기: commit 전에는 GET이 아닌 요청(문서 이동 · XHR · fetch) 모두 막음, commit 뒤에도 허용 출처로만.
    commit 뒤의 실패는 "쓰기는 됐을 수 있어요"로 알림
```

- 표: `integrations`에 `mode` · `reviewer_id` · `repaired_at`, 상태 `reviewing`. `integration_reviews`(버전마다 한 번, 고치지 않음). `runs`에 `approval_id`, 상태 `held` · `dropped` · `unknown`. `browse_seen`(작업마다 하나) · `suggestions`(사이트 · 열쇠마다 하나)
- 남는 한계: commit 전에 POST로 데이터를 읽는 사이트는 쓰기 도구로 굳히지 못한다. 마른 실행은 commit 뒤 화면을 보지 못해 답 형식은 진짜 실행에서야 검사한다
- 설계(승인안)와 달라진 것: 검토 결과는 `integration_revisions.review` 칸 대신 고치지 않는 표 `integration_reviews`에 둔다 (버전 표는 UPDATE를 막아서)

