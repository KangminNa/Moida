// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { bigint, boolean, integer, jsonb, pgSchema, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { CategoryOrigin, ChangeActorType, ChangeDomain, ChangeOp, ChangeOpStatus, ChangeOpTargetKind, ChangeOpVerdict, ChangeSetActorType, ChangeSetKind, ChangeSetStatus, EdgeActorType, EdgeDeletedByType, EdgeOrigin, GraphViewAudience, PostMarkStatus, ProjectRuleDefaultVisibility, ReviewRuleAction, RunMemoWrittenBy, SessionRevisionActorType, SessionRevisionKind, SessionTranscriptActorType, SessionVisibility, TidySettingCadence, WikiOrigin, WikiRevisionActorType, WikiRevisionKind, WikiVisibility } from './vault.tables';

const vaultSchema = pgSchema('vault');

/** vault.app_marks */
export const appMarks = vaultSchema.table('app_marks', {
  app_id: uuid('app_id').notNull(),
  space_id: uuid('space_id').notNull(),
  public: boolean('public').notNull(),
  app_version: integer('app_version').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** vault.categories */
export const categories = vaultSchema.table('categories', {
  node_id: uuid('node_id').notNull(),
  space_id: uuid('space_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  color: text('color'),
  description: text('description'),
  origin: text('origin').$type<CategoryOrigin>().notNull(),
  pinned: boolean('pinned').notNull(),
  version: integer('version').notNull(),
  meta: jsonb('meta').notNull(),
  sort: integer('sort').notNull(),
});

/** vault.change_ops */
export const changeOps = vaultSchema.table('change_ops', {
  change_set_id: uuid('change_set_id').notNull(),
  seq: integer('seq').notNull(),
  op: text('op').notNull(),
  target_kind: text('target_kind').$type<ChangeOpTargetKind>().notNull(),
  target_id: uuid('target_id'),
  base_version: integer('base_version'),
  payload: jsonb('payload').notNull(),
  verdict: text('verdict').$type<ChangeOpVerdict>(),
  rule: text('rule'),
  status: text('status').$type<ChangeOpStatus>().notNull(),
  reason: text('reason'),
  decided_at: timestamp('decided_at', { withTimezone: true }),
  decided_by: uuid('decided_by'),
});

/** vault.change_sets */
export const changeSets = vaultSchema.table('change_sets', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  kind: text('kind').$type<ChangeSetKind>().notNull(),
  status: text('status').$type<ChangeSetStatus>().notNull(),
  actor_type: text('actor_type').$type<ChangeSetActorType>().notNull(),
  actor_id: uuid('actor_id'),
  job_id: uuid('job_id'),
  message: text('message').notNull(),
  op_count: integer('op_count').notNull(),
  reverted_by: uuid('reverted_by'),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  submitted_at: timestamp('submitted_at', { withTimezone: true }),
  closed_at: timestamp('closed_at', { withTimezone: true }),
});

/** vault.changes */
export const changes = vaultSchema.table('changes', {
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  id: bigint('id', { mode: 'number' }).notNull(),
  space_id: uuid('space_id').notNull(),
  batch_id: uuid('batch_id').notNull(),
  actor_type: text('actor_type').$type<ChangeActorType>().notNull(),
  actor_id: uuid('actor_id'),
  domain: text('domain').$type<ChangeDomain>().notNull(),
  entity: text('entity').notNull(),
  entity_id: uuid('entity_id').notNull(),
  op: text('op').$type<ChangeOp>().notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  undone_by: uuid('undone_by'),
});

/** vault.edge_kinds */
export const edgeKinds = vaultSchema.table('edge_kinds', {
  name: text('name').notNull(),
  directed: boolean('directed').notNull(),
  ai_creatable: boolean('ai_creatable').notNull(),
  description: text('description'),
});

/** vault.edges */
export const edges = vaultSchema.table('edges', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  src: uuid('src').notNull(),
  dst: uuid('dst').notNull(),
  kind: text('kind').notNull(),
  weight: real('weight'),
  origin: text('origin').$type<EdgeOrigin>().notNull(),
  pinned: boolean('pinned').notNull(),
  version: integer('version').notNull(),
  actor_type: text('actor_type').$type<EdgeActorType>(),
  actor_id: uuid('actor_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  deleted_by_type: text('deleted_by_type').$type<EdgeDeletedByType>(),
});

/** vault.graph_views */
export const graphViews = vaultSchema.table('graph_views', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  name: text('name').notNull(),
  audience: text('audience').$type<GraphViewAudience>().notNull(),
  version: bigint('version', { mode: 'number' }).notNull(),
  built_at: timestamp('built_at', { withTimezone: true }),
  settings: jsonb('settings').notNull(),
  is_default: boolean('is_default').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** vault.node_kinds */
export const nodeKinds = vaultSchema.table('node_kinds', {
  name: text('name').notNull(),
  description: text('description'),
});

/** vault.node_layout */
export const nodeLayout = vaultSchema.table('node_layout', {
  view_id: uuid('view_id').notNull(),
  node_id: uuid('node_id').notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
  pinned: boolean('pinned').notNull(),
});

/** vault.nodes */
export const nodes = vaultSchema.table('nodes', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  kind: text('kind').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  purge_after: timestamp('purge_after', { withTimezone: true }),
});

/** vault.post_marks */
export const postMarks = vaultSchema.table('post_marks', {
  post_id: uuid('post_id').notNull(),
  space_id: uuid('space_id').notNull(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  status: text('status').$type<PostMarkStatus>().notNull(),
  main_wiki_id: uuid('main_wiki_id'),
  ref_wiki_ids: uuid('ref_wiki_ids').array().notNull(),
  post_version: integer('post_version').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  app_id: uuid('app_id'),
});

/** vault.project_rules */
export const projectRules = vaultSchema.table('project_rules', {
  space_id: uuid('space_id').notNull(),
  project: text('project').notNull(),
  default_visibility: text('default_visibility').$type<ProjectRuleDefaultVisibility>().notNull(),
  collect: boolean('collect').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** vault.review_rules */
export const reviewRules = vaultSchema.table('review_rules', {
  space_id: uuid('space_id').notNull(),
  key: text('key').notNull(),
  action: text('action').$type<ReviewRuleAction>().notNull(),
  value: integer('value'),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  updated_by: uuid('updated_by'),
});

/** vault.run_memos */
export const runMemos = vaultSchema.table('run_memos', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  session_id: uuid('session_id').notNull(),
  transcript_seq: integer('transcript_seq').notNull(),
  lineage: text('lineage').notNull(),
  task_id: uuid('task_id').notNull(),
  run_seq: integer('run_seq').notNull(),
  agent_id: uuid('agent_id'),
  agent_name: text('agent_name').notNull(),
  task_title: text('task_title').notNull(),
  memo: text('memo').notNull(),
  written_by: text('written_by').$type<RunMemoWrittenBy>().notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** vault.session_revisions */
export const sessionRevisions = vaultSchema.table('session_revisions', {
  id: uuid('id').notNull(),
  session_id: uuid('session_id').notNull(),
  seq: integer('seq').notNull(),
  kind: text('kind').$type<SessionRevisionKind>().notNull(),
  parent_ids: uuid('parent_ids').array().notNull(),
  base_revision_id: uuid('base_revision_id'),
  body_md: text('body_md').notNull(),
  sections: jsonb('sections').notNull(),
  sections_schema: integer('sections_schema').notNull(),
  section_hashes: jsonb('section_hashes').notNull(),
  content_hash: text('content_hash').notNull(),
  redactions: jsonb('redactions'),
  actor_type: text('actor_type').$type<SessionRevisionActorType>().notNull(),
  actor_id: uuid('actor_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** vault.session_transcripts */
export const sessionTranscripts = vaultSchema.table('session_transcripts', {
  id: uuid('id').notNull(),
  session_id: uuid('session_id').notNull(),
  seq: integer('seq').notNull(),
  text: text('text').notNull(),
  content_hash: text('content_hash').notNull(),
  redactions: jsonb('redactions'),
  actor_type: text('actor_type').$type<SessionTranscriptActorType>().notNull(),
  actor_id: uuid('actor_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** vault.sessions */
export const sessions = vaultSchema.table('sessions', {
  node_id: uuid('node_id').notNull(),
  space_id: uuid('space_id').notNull(),
  device_id: uuid('device_id').notNull(),
  tool: text('tool').notNull(),
  source_session_id: text('source_session_id').notNull(),
  project: text('project'),
  visibility: text('visibility').$type<SessionVisibility>().notNull(),
  head_revision_id: uuid('head_revision_id'),
  version: integer('version').notNull(),
  pinned_sections: text('pinned_sections').array().notNull(),
  head_title: text('head_title'),
  head_text: text('head_text'),
  revision_count: integer('revision_count').notNull(),
  started_at: timestamp('started_at', { withTimezone: true }),
  last_revision_at: timestamp('last_revision_at', { withTimezone: true }),
  meta: jsonb('meta').notNull(),
  wiki_id: uuid('wiki_id'),
  tidy_requested_seq: integer('tidy_requested_seq').notNull(),
  transcript_count: integer('transcript_count').notNull(),
  noted_seq: integer('noted_seq').notNull(),
});

/** vault.stale_wikis */
export const staleWikis = vaultSchema.table('stale_wikis', {
  wiki_id: uuid('wiki_id').notNull(),
  space_id: uuid('space_id').notNull(),
  score: real('score').notNull(),
  noticed_at: timestamp('noticed_at', { withTimezone: true }).notNull(),
});

/** vault.tidy_settings */
export const tidySettings = vaultSchema.table('tidy_settings', {
  space_id: uuid('space_id').notNull(),
  auto_tidy: boolean('auto_tidy').notNull(),
  version: integer('version').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  cadence: text('cadence').$type<TidySettingCadence>().notNull(),
  daily_at: timestamp('daily_at', { withTimezone: true }),
});

/** vault.wiki_aliases */
export const wikiAliases = vaultSchema.table('wiki_aliases', {
  old_id: uuid('old_id').notNull(),
  space_id: uuid('space_id').notNull(),
  new_id: uuid('new_id').notNull(),
  change_set_id: uuid('change_set_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** vault.wiki_revisions */
export const wikiRevisions = vaultSchema.table('wiki_revisions', {
  id: uuid('id').notNull(),
  wiki_id: uuid('wiki_id').notNull(),
  seq: integer('seq').notNull(),
  kind: text('kind').$type<WikiRevisionKind>().notNull(),
  base_revision_id: uuid('base_revision_id'),
  change_set_id: uuid('change_set_id'),
  body_md: text('body_md').notNull(),
  sections: jsonb('sections').notNull(),
  section_hashes: jsonb('section_hashes').notNull(),
  content_hash: text('content_hash').notNull(),
  actor_type: text('actor_type').$type<WikiRevisionActorType>().notNull(),
  actor_id: uuid('actor_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** vault.wikis */
export const wikis = vaultSchema.table('wikis', {
  node_id: uuid('node_id').notNull(),
  space_id: uuid('space_id').notNull(),
  category_id: uuid('category_id'),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  visibility: text('visibility').$type<WikiVisibility>().notNull(),
  origin: text('origin').$type<WikiOrigin>().notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  meta: jsonb('meta').notNull(),
  head_revision_id: uuid('head_revision_id'),
  pinned_sections: text('pinned_sections').array().notNull(),
  head_text: text('head_text'),
  revision_count: integer('revision_count').notNull(),
});
