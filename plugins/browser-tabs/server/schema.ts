// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { TableColumns } from '../../../apps/server/src/plugin-api';

const { customType, integer, jsonb, pgSchema, text, timestamp, uuid } = TableColumns;

const byteaColumn = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const browserTabsSchema = pgSchema('browser_tabs');

/** browser_tabs.browse_seen */
export const browseSeen = browserTabsSchema.table('browse_seen', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  site_id: uuid('site_id').notNull(),
  task_id: uuid('task_id').notNull(),
  key: text('key').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** browser_tabs.clicks */
export const clicks = browserTabsSchema.table('clicks', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  task_id: uuid('task_id').notNull(),
  site_id: uuid('site_id').notNull(),
  runner_id: uuid('runner_id').notNull(),
  tab_id: text('tab_id').notNull(),
  page_url: text('page_url').notNull(),
  page_title: text('page_title').notNull(),
  role: text('role').notNull(),
  name: text('name').notNull(),
  nth: integer('nth').notNull(),
  box: jsonb('box').notNull(),
  fingerprint: text('fingerprint').notNull(),
  note: text('note'),
  status: text('status').notNull(),
  approval_id: uuid('approval_id'),
  reason: text('reason'),
  after_url: text('after_url'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  decided_at: timestamp('decided_at', { withTimezone: true }),
  clicked_at: timestamp('clicked_at', { withTimezone: true }),
  version: integer('version').notNull(),
});

/** browser_tabs.integration_reviews */
export const integrationReviews = browserTabsSchema.table('integration_reviews', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  integration_id: uuid('integration_id').notNull(),
  seq: integer('seq').notNull(),
  reviewer_id: uuid('reviewer_id').notNull(),
  verdict: text('verdict').notNull(),
  notes: text('notes').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** browser_tabs.integration_revisions */
export const integrationRevisions = browserTabsSchema.table('integration_revisions', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  integration_id: uuid('integration_id').notNull(),
  seq: integer('seq').notNull(),
  input_schema: jsonb('input_schema').notNull(),
  output_schema: jsonb('output_schema').notNull(),
  code: text('code').notNull(),
  tests: jsonb('tests').notNull(),
  passed: integer('passed').notNull(),
  total: integer('total').notNull(),
  build_task_id: uuid('build_task_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** browser_tabs.integrations */
export const integrations = browserTabsSchema.table('integrations', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  site_id: uuid('site_id').notNull(),
  name: text('name').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  hint: text('hint').notNull(),
  agent_id: uuid('agent_id'),
  status: text('status').notNull(),
  live_seq: integer('live_seq'),
  draft_seq: integer('draft_seq'),
  build_task_id: uuid('build_task_id'),
  fail_streak: integer('fail_streak').notNull(),
  runs_ok: integer('runs_ok').notNull(),
  runs_failed: integer('runs_failed').notNull(),
  last_run_at: timestamp('last_run_at', { withTimezone: true }),
  last_error: text('last_error'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull(),
  mode: text('mode').notNull(),
  reviewer_id: uuid('reviewer_id'),
  repaired_at: timestamp('repaired_at', { withTimezone: true }),
});

/** browser_tabs.reads */
export const reads = browserTabsSchema.table('reads', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  url: text('url').notNull(),
  status: text('status').notNull(),
  title: text('title'),
  body: text('body'),
  error: text('error'),
  requested_at: timestamp('requested_at', { withTimezone: true }).notNull(),
  read_at: timestamp('read_at', { withTimezone: true }),
  version: integer('version').notNull(),
});

/** browser_tabs.runs */
export const runs = browserTabsSchema.table('runs', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  integration_id: uuid('integration_id').notNull(),
  seq: integer('seq').notNull(),
  agent_id: uuid('agent_id').notNull(),
  request_id: text('request_id').notNull(),
  input: jsonb('input').notNull(),
  status: text('status').notNull(),
  output: jsonb('output'),
  error: text('error'),
  error_kind: text('error_kind'),
  runner_id: uuid('runner_id'),
  tries: integer('tries').notNull(),
  ms: integer('ms'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  started_at: timestamp('started_at', { withTimezone: true }),
  finished_at: timestamp('finished_at', { withTimezone: true }),
  version: integer('version').notNull(),
  approval_id: uuid('approval_id'),
});

/** browser_tabs.shots */
export const shots = browserTabsSchema.table('shots', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  task_id: uuid('task_id').notNull(),
  click_id: uuid('click_id'),
  kind: text('kind').notNull(),
  seq: integer('seq').notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  image: byteaColumn('image').notNull(),
  mime: text('mime').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** browser_tabs.sites */
export const sites = browserTabsSchema.table('sites', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  name: text('name').notNull(),
  start_url: text('start_url').notNull(),
  origins: text('origins').array().notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull(),
  login_needed_at: timestamp('login_needed_at', { withTimezone: true }),
});

/** browser_tabs.suggestions */
export const suggestions = browserTabsSchema.table('suggestions', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  site_id: uuid('site_id').notNull(),
  key: text('key').notNull(),
  count: integer('count').notNull(),
  sample: text('sample').notNull(),
  status: text('status').notNull(),
  integration_id: uuid('integration_id'),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull(),
});
