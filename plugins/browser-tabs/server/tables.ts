// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** browser_tabs.browse_seen */
export interface BrowseSeenRow {
  id: string;
  space_id: string;
  site_id: string;
  task_id: string;
  key: string;
  created_at: Date;
}
export type BrowseSeenNew = Partial<BrowseSeenRow> & Pick<BrowseSeenRow, 'id' | 'space_id' | 'site_id' | 'task_id' | 'key'>;

/** browser_tabs.click_plans.status (값 목록 CHECK) */
export const CLICK_PLAN_STATUS = ['held', 'approved', 'closed', 'dropped'] as const;
export type ClickPlanStatus = (typeof CLICK_PLAN_STATUS)[number];
/** browser_tabs.click_plans */
export interface ClickPlanRow {
  id: string;
  space_id: string;
  task_id: string;
  site_id: string;
  page_url: string;
  summary: string;
  max_clicks: number;
  used: number;
  status: ClickPlanStatus;
  approval_id: string | null;
  created_at: Date;
  decided_at: Date | null;
  version: number;
}
export type ClickPlanNew = Partial<ClickPlanRow> & Pick<ClickPlanRow, 'id' | 'space_id' | 'task_id' | 'site_id' | 'page_url' | 'summary' | 'max_clicks'>;

/** browser_tabs.clicks.status (값 목록 CHECK) */
export const CLICK_STATUS = ['requested', 'held', 'approved', 'clicking', 'clicked', 'changed', 'unknown', 'dropped', 'manual'] as const;
export type ClickStatus = (typeof CLICK_STATUS)[number];
/** browser_tabs.clicks */
export interface ClickRow {
  id: string;
  space_id: string;
  task_id: string;
  site_id: string;
  runner_id: string | null;
  tab_id: string | null;
  page_url: string;
  page_title: string;
  role: string;
  name: string;
  nth: number;
  box: unknown | null;
  fingerprint: string | null;
  note: string | null;
  status: ClickStatus;
  approval_id: string | null;
  reason: string | null;
  after_url: string | null;
  created_at: Date;
  decided_at: Date | null;
  clicked_at: Date | null;
  version: number;
  plan_id: string | null;
}
export type ClickNew = Partial<ClickRow> & Pick<ClickRow, 'id' | 'space_id' | 'task_id' | 'site_id' | 'page_url' | 'role' | 'name'>;

/** browser_tabs.endpoints */
export interface EndpointRow {
  id: string;
  space_id: string;
  site_id: string;
  method: string;
  origin: string;
  path: string;
  query: readonly string[];
  body: unknown | null;
  response: unknown | null;
  status: number;
  content_type: string;
  seen: number;
  last_task_id: string;
  created_at: Date;
  updated_at: Date;
}
export type EndpointNew = Partial<EndpointRow> & Pick<EndpointRow, 'id' | 'space_id' | 'site_id' | 'method' | 'origin' | 'path' | 'last_task_id'>;

/** browser_tabs.integration_reviews.verdict (값 목록 CHECK) */
export const INTEGRATION_REVIEW_VERDICT = ['pass', 'fix'] as const;
export type IntegrationReviewVerdict = (typeof INTEGRATION_REVIEW_VERDICT)[number];
/** browser_tabs.integration_reviews */
export interface IntegrationReviewRow {
  id: string;
  space_id: string;
  integration_id: string;
  seq: number;
  reviewer_id: string;
  verdict: IntegrationReviewVerdict;
  notes: string;
  created_at: Date;
}
export type IntegrationReviewNew = Partial<IntegrationReviewRow> & Pick<IntegrationReviewRow, 'id' | 'space_id' | 'integration_id' | 'seq' | 'reviewer_id' | 'verdict'>;

/** browser_tabs.integration_revisions */
export interface IntegrationRevisionRow {
  id: string;
  space_id: string;
  integration_id: string;
  seq: number;
  input_schema: unknown;
  output_schema: unknown;
  code: string;
  tests: unknown;
  passed: number;
  total: number;
  build_task_id: string;
  created_at: Date;
}
export type IntegrationRevisionNew = Partial<IntegrationRevisionRow> & Pick<IntegrationRevisionRow, 'id' | 'space_id' | 'integration_id' | 'seq' | 'input_schema' | 'output_schema' | 'code' | 'tests' | 'passed' | 'total' | 'build_task_id'>;

/** browser_tabs.integrations.status (값 목록 CHECK) */
export const INTEGRATION_STATUS = ['building', 'reviewing', 'review', 'on', 'broken', 'off'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUS)[number];
/** browser_tabs.integrations.mode (값 목록 CHECK) */
export const INTEGRATION_MODE = ['read', 'write'] as const;
export type IntegrationMode = (typeof INTEGRATION_MODE)[number];
/** browser_tabs.integrations */
export interface IntegrationRow {
  id: string;
  space_id: string;
  site_id: string;
  name: string;
  title: string;
  description: string;
  hint: string;
  agent_id: string | null;
  status: IntegrationStatus;
  live_seq: number | null;
  draft_seq: number | null;
  build_task_id: string | null;
  fail_streak: number;
  runs_ok: number;
  runs_failed: number;
  last_run_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
  mode: IntegrationMode;
  reviewer_id: string | null;
  repaired_at: Date | null;
}
export type IntegrationNew = Partial<IntegrationRow> & Pick<IntegrationRow, 'id' | 'space_id' | 'site_id' | 'name' | 'title' | 'description'>;

/** browser_tabs.reads.status (값 목록 CHECK) */
export const READ_STATUS = ['requested', 'done', 'failed'] as const;
export type ReadStatus = (typeof READ_STATUS)[number];
/** browser_tabs.reads */
export interface ReadRow {
  id: string;
  space_id: string;
  url: string;
  status: ReadStatus;
  title: string | null;
  body: string | null;
  error: string | null;
  requested_at: Date;
  read_at: Date | null;
  version: number;
}
export type ReadNew = Partial<ReadRow> & Pick<ReadRow, 'id' | 'space_id' | 'url'>;

/** browser_tabs.runs.status (값 목록 CHECK) */
export const RUN_STATUS = ['held', 'queued', 'running', 'done', 'failed', 'dropped', 'unknown'] as const;
export type RunStatus = (typeof RUN_STATUS)[number];
/** browser_tabs.runs.error_kind (값 목록 CHECK) */
export const RUN_ERROR_KIND = ['login', 'timeout', 'shape', 'code', 'lost', 'off'] as const;
export type RunErrorKind = (typeof RUN_ERROR_KIND)[number];
/** browser_tabs.runs */
export interface RunRow {
  id: string;
  space_id: string;
  integration_id: string;
  seq: number;
  agent_id: string;
  request_id: string;
  input: unknown;
  status: RunStatus;
  output: unknown | null;
  error: string | null;
  error_kind: RunErrorKind | null;
  runner_id: string | null;
  tries: number;
  ms: number | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  version: number;
  approval_id: string | null;
}
export type RunNew = Partial<RunRow> & Pick<RunRow, 'id' | 'space_id' | 'integration_id' | 'seq' | 'agent_id' | 'request_id' | 'input'>;

/** browser_tabs.shots.kind (값 목록 CHECK) */
export const SHOT_KIND = ['step', 'login', 'before', 'after', 'changed'] as const;
export type ShotKind = (typeof SHOT_KIND)[number];
/** browser_tabs.shots.mime (값 목록 CHECK) */
export const SHOT_MIME = ['image/jpeg', 'image/png'] as const;
export type ShotMime = (typeof SHOT_MIME)[number];
/** browser_tabs.shots */
export interface ShotRow {
  id: string;
  space_id: string;
  task_id: string;
  click_id: string | null;
  kind: ShotKind;
  seq: number;
  url: string;
  title: string;
  image: Buffer;
  mime: ShotMime;
  created_at: Date;
}
export type ShotNew = Partial<ShotRow> & Pick<ShotRow, 'id' | 'space_id' | 'task_id' | 'kind' | 'seq' | 'image' | 'mime'>;

/** browser_tabs.sites */
export interface SiteRow {
  id: string;
  space_id: string;
  name: string;
  start_url: string;
  origins: readonly string[];
  created_at: Date;
  updated_at: Date;
  version: number;
  login_needed_at: Date | null;
  login_form: unknown | null;
  trusted_at: Date | null;
  api_build_at: Date | null;
}
export type SiteNew = Partial<SiteRow> & Pick<SiteRow, 'id' | 'space_id' | 'name' | 'start_url' | 'origins'>;

/** browser_tabs.suggestions.status (값 목록 CHECK) */
export const SUGGESTION_STATUS = ['open', 'dismissed', 'made'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUS)[number];
/** browser_tabs.suggestions */
export interface SuggestionRow {
  id: string;
  space_id: string;
  site_id: string;
  key: string;
  count: number;
  sample: string;
  status: SuggestionStatus;
  integration_id: string | null;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
  version: number;
  note: string;
}
export type SuggestionNew = Partial<SuggestionRow> & Pick<SuggestionRow, 'id' | 'space_id' | 'site_id' | 'key' | 'count' | 'sample'>;
