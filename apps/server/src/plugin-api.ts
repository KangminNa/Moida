// 플러그인이 가져다 쓸 수 있는 유일한 입구. 플러그인 서버 파일은 이 파일만 import한다 (pnpm check가 막는다).
// 여기서 내보내는 것을 바꾸면 플러그인 API 버전(CAIRN_PLUGIN_API)과 docs/객체설계.md 12장을 함께 고친다.
// 0.2 (2026-11-08): 기능 패키지 — 동작(Read · Command)과 일하는 자리(Work: 자기 스키마의 조건 규칙), 오류
// 0.3 (2026-11-10): work.leased(id) — 러너가 부른 도구를 그 러너가 임대를 쥔 일(LeasedWork)에 묶는다 (code-github)
// 0.4 (2026-11-14): LeasedWork의 대상(targetKind · targetId · targetVersion) — 작업이 가리키는 패키지의 줄 (browser-tabs의 사이트 · 클릭)
// 0.5 (2026-11-16): LeasedWork의 지시(instruction) — 되풀이되는 일 알아채기 (browser-tabs의 사이트 도구 제안)
// 0.6 (리팩토링 R2): ValueList — 생성된 값 목록(tables.ts의 `as const`)으로 글자를 좁힌다
// 0.7 (2026-11-19): LeasedWork의 관리자가 쓴 지시(ownerText) — browser-tabs의 로그인 카드가 믿는 주소인지 본다
// 0.8 (2026-11-21): actor.runTask() — 에이전트(작업 토큰)가 부른 도구를 지금 하는 일에 묶는다. 결과 이벤트의 outcome continue —
//     결재를 기다리던 작업을 다시 대기열로 (browser-tabs의 누르기 계획: 계획을 승인하면 같은 일이 이어서 누른다)
// 0.10 (2026-11-23): work.sendChat — uses의 chat을 허락받은 쓰기 동작이 관리자의 대화에 말을 넣는다 (ChatSent, messenger-telegram)
// 0.11 (2026-11-25): work.place · AttemptLimiter · TooManyRequests — 방문자가 부르는 동작이 곳(IP)마다 횟수를 센다 (map의 찾기)
// 0.12 (2026-11-26): platform.notice.sent 이벤트 — 푸시로 가는 알림(같은 때 · 같은 묶음)을 플러그인도 받는다 (email)
export {
  ActionResult,
  Actor,
  ArchiveFile,
  type ArchiveRestoreService,
  AttemptLimiter,
  BaseAction,
  BaseGateway,
  BaseHandler,
  BaseJob,
  BaseLogin,
  BasePlugin,
  ChatSent,
  Command,
  Conflict,
  DomainError,
  DomainEvent,
  ExternalFailure,
  type How,
  InvalidRequest,
  LeasedWork,
  LoginIdentity,
  NotFound,
  Operation,
  OwnerActor,
  type PluginContext,
  Read,
  type RequestFields,
  type RowOf,
  Rule,
  RuleViolation,
  SystemActor,
  TableColumns,
  type ToolAnswer,
  TooManyRequests,
  ValueList,
  VisitorActor,
  type Where,
  Work,
} from './modules/platform';
