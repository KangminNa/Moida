// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** vault.categories.origin (값 목록 CHECK) */
export const CATEGORY_ORIGIN = ['ai', 'human'] as const;
export type CategoryOrigin = (typeof CATEGORY_ORIGIN)[number];
/** vault.categories */
export interface CategoryRow {
  node_id: string;
  space_id: string;
  name: string;
  slug: string;
  color: string | null;
  description: string | null;
  origin: CategoryOrigin;
  pinned: boolean;
  version: number;
  meta: unknown;
  sort: number;
}
export type CategoryNew = Partial<CategoryRow> & Pick<CategoryRow, 'node_id' | 'space_id' | 'name' | 'slug' | 'origin'>;

/** vault.change_ops.target_kind (값 목록 CHECK) */
export const CHANGE_OP_TARGET_KIND = ['session', 'wiki', 'category', 'edge'] as const;
export type ChangeOpTargetKind = (typeof CHANGE_OP_TARGET_KIND)[number];
/** vault.change_ops.verdict (값 목록 CHECK) */
export const CHANGE_OP_VERDICT = ['merge', 'review', 'reject'] as const;
export type ChangeOpVerdict = (typeof CHANGE_OP_VERDICT)[number];
/** vault.change_ops.status (값 목록 CHECK) */
export const CHANGE_OP_STATUS = ['pending', 'applied', 'waiting', 'approved', 'declined', 'rejected', 'superseded'] as const;
export type ChangeOpStatus = (typeof CHANGE_OP_STATUS)[number];
/** vault.change_ops */
export interface ChangeOpRow {
  change_set_id: string;
  seq: number;
  op: string;
  target_kind: ChangeOpTargetKind;
  target_id: string | null;
  base_version: number | null;
  payload: unknown;
  verdict: ChangeOpVerdict | null;
  rule: string | null;
  status: ChangeOpStatus;
  reason: string | null;
  decided_at: Date | null;
  decided_by: string | null;
}
export type ChangeOpNew = Partial<ChangeOpRow> & Pick<ChangeOpRow, 'change_set_id' | 'seq' | 'op' | 'target_kind' | 'status'>;

/** vault.change_sets.kind (값 목록 CHECK) */
export const CHANGE_SET_KIND = ['tidy', 'reorg', 'human', 'revert', 'system'] as const;
export type ChangeSetKind = (typeof CHANGE_SET_KIND)[number];
/** vault.change_sets.status (값 목록 CHECK) */
export const CHANGE_SET_STATUS = ['open', 'review', 'done'] as const;
export type ChangeSetStatus = (typeof CHANGE_SET_STATUS)[number];
/** vault.change_sets.actor_type (값 목록 CHECK) */
export const CHANGE_SET_ACTOR_TYPE = ['user', 'device', 'ai', 'system'] as const;
export type ChangeSetActorType = (typeof CHANGE_SET_ACTOR_TYPE)[number];
/** vault.change_sets */
export interface ChangeSetRow {
  id: string;
  space_id: string;
  kind: ChangeSetKind;
  status: ChangeSetStatus;
  actor_type: ChangeSetActorType;
  actor_id: string | null;
  job_id: string | null;
  message: string;
  op_count: number;
  reverted_by: string | null;
  version: number;
  created_at: Date;
  submitted_at: Date | null;
  closed_at: Date | null;
}
export type ChangeSetNew = Partial<ChangeSetRow> & Pick<ChangeSetRow, 'id' | 'space_id' | 'kind' | 'status' | 'actor_type'>;

/** vault.changes.actor_type (값 목록 CHECK) */
export const CHANGE_ACTOR_TYPE = ['user', 'device', 'ai', 'system'] as const;
export type ChangeActorType = (typeof CHANGE_ACTOR_TYPE)[number];
/** vault.changes.domain (값 목록 CHECK) */
export const CHANGE_DOMAIN = ['app', 'vault', 'blog', 'work'] as const;
export type ChangeDomain = (typeof CHANGE_DOMAIN)[number];
/** vault.changes.op (값 목록 CHECK) */
export const CHANGE_OP = ['insert', 'update', 'delete', 'restore'] as const;
export type ChangeOp = (typeof CHANGE_OP)[number];
/** vault.changes */
export interface ChangeRow {
  created_at: Date;
  id: number;
  space_id: string;
  batch_id: string;
  actor_type: ChangeActorType;
  actor_id: string | null;
  domain: ChangeDomain;
  entity: string;
  entity_id: string;
  op: ChangeOp;
  before: unknown | null;
  after: unknown | null;
  undone_by: string | null;
}
export type ChangeNew = Partial<ChangeRow> & Pick<ChangeRow, 'id' | 'space_id' | 'batch_id' | 'actor_type' | 'domain' | 'entity' | 'entity_id' | 'op'>;

/** vault.edge_kinds */
export interface EdgeKindRow {
  name: string;
  directed: boolean;
  ai_creatable: boolean;
  description: string | null;
}
export type EdgeKindNew = Partial<EdgeKindRow> & Pick<EdgeKindRow, 'name' | 'directed' | 'ai_creatable'>;

/** vault.edges.origin (값 목록 CHECK) */
export const EDGE_ORIGIN = ['ai', 'human'] as const;
export type EdgeOrigin = (typeof EDGE_ORIGIN)[number];
/** vault.edges.actor_type (값 목록 CHECK) */
export const EDGE_ACTOR_TYPE = ['user', 'device', 'ai', 'system'] as const;
export type EdgeActorType = (typeof EDGE_ACTOR_TYPE)[number];
/** vault.edges.deleted_by_type (값 목록 CHECK) */
export const EDGE_DELETED_BY_TYPE = ['user', 'device', 'ai', 'system'] as const;
export type EdgeDeletedByType = (typeof EDGE_DELETED_BY_TYPE)[number];
/** vault.edges */
export interface EdgeRow {
  id: string;
  space_id: string;
  src: string;
  dst: string;
  kind: string;
  weight: number | null;
  origin: EdgeOrigin;
  pinned: boolean;
  version: number;
  actor_type: EdgeActorType | null;
  actor_id: string | null;
  created_at: Date;
  deleted_at: Date | null;
  deleted_by_type: EdgeDeletedByType | null;
}
export type EdgeNew = Partial<EdgeRow> & Pick<EdgeRow, 'id' | 'space_id' | 'src' | 'dst' | 'kind' | 'origin'>;

/** vault.graph_views.audience (값 목록 CHECK) */
export const GRAPH_VIEW_AUDIENCE = ['public', 'owner'] as const;
export type GraphViewAudience = (typeof GRAPH_VIEW_AUDIENCE)[number];
/** vault.graph_views */
export interface GraphViewRow {
  id: string;
  space_id: string;
  name: string;
  audience: GraphViewAudience;
  version: number;
  built_at: Date | null;
  settings: unknown;
  is_default: boolean;
  updated_at: Date;
}
export type GraphViewNew = Partial<GraphViewRow> & Pick<GraphViewRow, 'id' | 'space_id' | 'name' | 'audience'>;

/** vault.node_kinds */
export interface NodeKindRow {
  name: string;
  description: string | null;
}
export type NodeKindNew = Partial<NodeKindRow> & Pick<NodeKindRow, 'name'>;

/** vault.node_layout */
export interface NodeLayoutRow {
  view_id: string;
  node_id: string;
  x: number;
  y: number;
  pinned: boolean;
}
export type NodeLayoutNew = Partial<NodeLayoutRow> & Pick<NodeLayoutRow, 'view_id' | 'node_id' | 'x' | 'y'>;

/** vault.nodes */
export interface NodeRow {
  id: string;
  space_id: string;
  kind: string;
  created_at: Date;
  deleted_at: Date | null;
  purge_after: Date | null;
}
export type NodeNew = Partial<NodeRow> & Pick<NodeRow, 'id' | 'space_id' | 'kind'>;

/** vault.post_marks.status (값 목록 CHECK) */
export const POST_MARK_STATUS = ['draft', 'published'] as const;
export type PostMarkStatus = (typeof POST_MARK_STATUS)[number];
/** vault.post_marks */
export interface PostMarkRow {
  post_id: string;
  space_id: string;
  title: string;
  slug: string;
  status: PostMarkStatus;
  main_wiki_id: string | null;
  ref_wiki_ids: readonly string[];
  post_version: number;
  updated_at: Date;
}
export type PostMarkNew = Partial<PostMarkRow> & Pick<PostMarkRow, 'post_id' | 'space_id' | 'title' | 'slug' | 'status' | 'post_version'>;

/** vault.project_rules.default_visibility (값 목록 CHECK) */
export const PROJECT_RULE_DEFAULT_VISIBILITY = ['private', 'public'] as const;
export type ProjectRuleDefaultVisibility = (typeof PROJECT_RULE_DEFAULT_VISIBILITY)[number];
/** vault.project_rules */
export interface ProjectRuleRow {
  space_id: string;
  project: string;
  default_visibility: ProjectRuleDefaultVisibility;
  collect: boolean;
  updated_at: Date;
}
export type ProjectRuleNew = Partial<ProjectRuleRow> & Pick<ProjectRuleRow, 'space_id' | 'project'>;

/** vault.review_rules.action (값 목록 CHECK) */
export const REVIEW_RULE_ACTION = ['merge', 'review', 'reject'] as const;
export type ReviewRuleAction = (typeof REVIEW_RULE_ACTION)[number];
/** vault.review_rules */
export interface ReviewRuleRow {
  space_id: string;
  key: string;
  action: ReviewRuleAction;
  value: number | null;
  updated_at: Date;
  updated_by: string | null;
}
export type ReviewRuleNew = Partial<ReviewRuleRow> & Pick<ReviewRuleRow, 'space_id' | 'key' | 'action'>;

/** vault.session_revisions.kind (값 목록 CHECK) */
export const SESSION_REVISION_KIND = ['origin', 'human', 'merge'] as const;
export type SessionRevisionKind = (typeof SESSION_REVISION_KIND)[number];
/** vault.session_revisions.actor_type (값 목록 CHECK) */
export const SESSION_REVISION_ACTOR_TYPE = ['user', 'device', 'ai', 'system'] as const;
export type SessionRevisionActorType = (typeof SESSION_REVISION_ACTOR_TYPE)[number];
/** vault.session_revisions */
export interface SessionRevisionRow {
  id: string;
  session_id: string;
  seq: number;
  kind: SessionRevisionKind;
  parent_ids: readonly string[];
  base_revision_id: string | null;
  body_md: string;
  sections: unknown;
  sections_schema: number;
  section_hashes: unknown;
  content_hash: string;
  redactions: unknown | null;
  actor_type: SessionRevisionActorType;
  actor_id: string | null;
  created_at: Date;
}
export type SessionRevisionNew = Partial<SessionRevisionRow> & Pick<SessionRevisionRow, 'id' | 'session_id' | 'seq' | 'kind' | 'body_md' | 'sections' | 'section_hashes' | 'content_hash' | 'actor_type'>;

/** vault.session_transcripts.actor_type (값 목록 CHECK) */
export const SESSION_TRANSCRIPT_ACTOR_TYPE = ['device', 'system'] as const;
export type SessionTranscriptActorType = (typeof SESSION_TRANSCRIPT_ACTOR_TYPE)[number];
/** vault.session_transcripts */
export interface SessionTranscriptRow {
  id: string;
  session_id: string;
  seq: number;
  text: string;
  content_hash: string;
  redactions: unknown | null;
  actor_type: SessionTranscriptActorType;
  actor_id: string | null;
  created_at: Date;
}
export type SessionTranscriptNew = Partial<SessionTranscriptRow> & Pick<SessionTranscriptRow, 'id' | 'session_id' | 'seq' | 'text' | 'content_hash' | 'actor_type'>;

/** vault.sessions.visibility (값 목록 CHECK) */
export const SESSION_VISIBILITY = ['private', 'public'] as const;
export type SessionVisibility = (typeof SESSION_VISIBILITY)[number];
/** vault.sessions */
export interface SessionRow {
  node_id: string;
  space_id: string;
  device_id: string;
  tool: string;
  source_session_id: string;
  project: string | null;
  visibility: SessionVisibility;
  head_revision_id: string | null;
  version: number;
  pinned_sections: readonly string[];
  head_title: string | null;
  head_text: string | null;
  revision_count: number;
  started_at: Date | null;
  last_revision_at: Date | null;
  meta: unknown;
  wiki_id: string | null;
  tidy_requested_seq: number;
  transcript_count: number;
  noted_seq: number;
}
export type SessionNew = Partial<SessionRow> & Pick<SessionRow, 'node_id' | 'space_id' | 'device_id' | 'tool' | 'source_session_id'>;

/** vault.stale_wikis */
export interface StaleWikiRow {
  wiki_id: string;
  space_id: string;
  score: number;
  noticed_at: Date;
}
export type StaleWikiNew = Partial<StaleWikiRow> & Pick<StaleWikiRow, 'wiki_id' | 'space_id' | 'score'>;

/** vault.tidy_settings.cadence (값 목록 CHECK) */
export const TIDY_SETTING_CADENCE = ['save', 'daily'] as const;
export type TidySettingCadence = (typeof TIDY_SETTING_CADENCE)[number];
/** vault.tidy_settings */
export interface TidySettingRow {
  space_id: string;
  auto_tidy: boolean;
  version: number;
  updated_at: Date;
  cadence: TidySettingCadence;
  daily_at: Date | null;
}
export type TidySettingNew = Partial<TidySettingRow> & Pick<TidySettingRow, 'space_id'>;

/** vault.wiki_aliases */
export interface WikiAliasRow {
  old_id: string;
  space_id: string;
  new_id: string;
  change_set_id: string | null;
  created_at: Date;
}
export type WikiAliasNew = Partial<WikiAliasRow> & Pick<WikiAliasRow, 'old_id' | 'space_id' | 'new_id'>;

/** vault.wiki_revisions.kind (값 목록 CHECK) */
export const WIKI_REVISION_KIND = ['ai', 'human', 'merge'] as const;
export type WikiRevisionKind = (typeof WIKI_REVISION_KIND)[number];
/** vault.wiki_revisions.actor_type (값 목록 CHECK) */
export const WIKI_REVISION_ACTOR_TYPE = ['user', 'device', 'ai', 'system'] as const;
export type WikiRevisionActorType = (typeof WIKI_REVISION_ACTOR_TYPE)[number];
/** vault.wiki_revisions */
export interface WikiRevisionRow {
  id: string;
  wiki_id: string;
  seq: number;
  kind: WikiRevisionKind;
  base_revision_id: string | null;
  change_set_id: string | null;
  body_md: string;
  sections: unknown;
  section_hashes: unknown;
  content_hash: string;
  actor_type: WikiRevisionActorType;
  actor_id: string | null;
  created_at: Date;
}
export type WikiRevisionNew = Partial<WikiRevisionRow> & Pick<WikiRevisionRow, 'id' | 'wiki_id' | 'seq' | 'kind' | 'body_md' | 'sections' | 'section_hashes' | 'content_hash' | 'actor_type'>;

/** vault.wikis.visibility (값 목록 CHECK) */
export const WIKI_VISIBILITY = ['private', 'public'] as const;
export type WikiVisibility = (typeof WIKI_VISIBILITY)[number];
/** vault.wikis.origin (값 목록 CHECK) */
export const WIKI_ORIGIN = ['ai', 'human'] as const;
export type WikiOrigin = (typeof WIKI_ORIGIN)[number];
/** vault.wikis */
export interface WikiRow {
  node_id: string;
  space_id: string;
  category_id: string | null;
  title: string;
  slug: string;
  visibility: WikiVisibility;
  origin: WikiOrigin;
  version: number;
  created_at: Date;
  updated_at: Date;
  meta: unknown;
  head_revision_id: string | null;
  pinned_sections: readonly string[];
  head_text: string | null;
  revision_count: number;
}
export type WikiNew = Partial<WikiRow> & Pick<WikiRow, 'node_id' | 'space_id' | 'title' | 'slug' | 'origin'>;
