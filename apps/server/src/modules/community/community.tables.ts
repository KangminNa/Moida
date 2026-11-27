// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** community.account_sessions */
export interface AccountSessionRow {
  id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_seen_at: Date | null;
  ended_at: Date | null;
  account_id: string;
  app_id: string | null;
}
export type AccountSessionNew = Partial<AccountSessionRow> & Pick<AccountSessionRow, 'id' | 'token_hash' | 'expires_at' | 'account_id'>;

/** community.accounts */
export interface AccountRow {
  id: string;
  space_id: string;
  login_id: string | null;
  email: string | null;
  password_hash: string;
  password_changed_at: Date;
  age_confirmed_at: Date;
  terms_version: number | null;
  privacy_version: number | null;
  suspended_until: Date | null;
  joined_at: Date;
  last_seen_at: Date | null;
  left_at: Date | null;
  version: number;
  news_agreed_at: Date | null;
}
export type AccountNew = Partial<AccountRow> & Pick<AccountRow, 'id' | 'space_id' | 'password_hash' | 'password_changed_at' | 'age_confirmed_at'>;

/** community.app_tables.read_rule (값 목록 CHECK) */
export const APP_TABLE_READ_RULE = ['anyone', 'member', 'owner', 'admin'] as const;
export type AppTableReadRule = (typeof APP_TABLE_READ_RULE)[number];
/** community.app_tables.write_rule (값 목록 CHECK) */
export const APP_TABLE_WRITE_RULE = ['member', 'owner', 'admin'] as const;
export type AppTableWriteRule = (typeof APP_TABLE_WRITE_RULE)[number];
/** community.app_tables */
export interface AppTableRow {
  id: string;
  app_id: string;
  name: string;
  columns: unknown;
  read_rule: AppTableReadRule;
  write_rule: AppTableWriteRule;
  open: boolean;
  applied_seq: number;
  created_at: Date;
  updated_at: Date;
  version: number;
  space_id: string;
}
export type AppTableNew = Partial<AppTableRow> & Pick<AppTableRow, 'id' | 'app_id' | 'name' | 'columns' | 'read_rule' | 'write_rule' | 'applied_seq' | 'space_id'>;

/** community.comments.state (값 목록 CHECK) */
export const COMMENT_STATE = ['shown', 'hidden', 'removed', 'deleted'] as const;
export type CommentState = (typeof COMMENT_STATE)[number];
/** community.comments.hidden_by (값 목록 CHECK) */
export const COMMENT_HIDDEN_BY = ['reports', 'owner'] as const;
export type CommentHiddenBy = (typeof COMMENT_HIDDEN_BY)[number];
/** community.comments */
export interface CommentRow {
  id: string;
  topic_id: string;
  app_id: string;
  member_id: string;
  body: string;
  body_key: string;
  state: CommentState;
  request_id: string;
  created_at: Date;
  version: number;
  hidden_by: CommentHiddenBy | null;
  decided_at: Date | null;
}
export type CommentNew = Partial<CommentRow> & Pick<CommentRow, 'id' | 'topic_id' | 'app_id' | 'member_id' | 'body' | 'body_key' | 'request_id'>;

/** community.decisions.action (값 목록 CHECK) */
export const DECISION_ACTION = ['hide', 'show', 'remove', 'block', 'unblock', 'reset_password'] as const;
export type DecisionAction = (typeof DECISION_ACTION)[number];
/** community.decisions.by_kind (값 목록 CHECK) */
export const DECISION_BY_KIND = ['system', 'owner', 'approved'] as const;
export type DecisionByKind = (typeof DECISION_BY_KIND)[number];
/** community.decisions */
export interface DecisionRow {
  id: string;
  app_id: string;
  topic_id: string | null;
  comment_id: string | null;
  member_id: string | null;
  action: DecisionAction;
  by_kind: DecisionByKind;
  by_id: string | null;
  note: string | null;
  created_at: Date;
}
export type DecisionNew = Partial<DecisionRow> & Pick<DecisionRow, 'id' | 'app_id' | 'action' | 'by_kind'>;

/** community.members */
export interface MemberRow {
  id: string;
  app_id: string;
  nickname: string;
  nickname_key: string;
  age_confirmed_at: Date;
  blocked_until: Date | null;
  block_note: string | null;
  joined_at: Date;
  renamed_at: Date | null;
  last_seen_at: Date | null;
  version: number;
  terms_version: number | null;
  privacy_version: number | null;
  left_at: Date | null;
  account_id: string | null;
}
export type MemberNew = Partial<MemberRow> & Pick<MemberRow, 'id' | 'app_id' | 'nickname' | 'nickname_key' | 'age_confirmed_at'>;

/** community.reports.reason (값 목록 CHECK) */
export const REPORT_REASON = ['spam', 'abuse', 'illegal', 'privacy', 'other'] as const;
export type ReportReason = (typeof REPORT_REASON)[number];
/** community.reports.state (값 목록 CHECK) */
export const REPORT_STATE = ['open', 'accepted', 'dismissed'] as const;
export type ReportState = (typeof REPORT_STATE)[number];
/** community.reports */
export interface ReportRow {
  id: string;
  app_id: string;
  topic_id: string | null;
  comment_id: string | null;
  member_id: string;
  reason: ReportReason;
  note: string | null;
  state: ReportState;
  created_at: Date;
  closed_at: Date | null;
  version: number;
}
export type ReportNew = Partial<ReportRow> & Pick<ReportRow, 'id' | 'app_id' | 'member_id' | 'reason'>;

/** community.terms.kind (값 목록 CHECK) */
export const TERM_KIND = ['terms', 'privacy'] as const;
export type TermKind = (typeof TERM_KIND)[number];
/** community.terms.by_kind (값 목록 CHECK) */
export const TERM_BY_KIND = ['owner', 'approved'] as const;
export type TermByKind = (typeof TERM_BY_KIND)[number];
/** community.terms */
export interface TermRow {
  id: string;
  app_id: string | null;
  kind: TermKind;
  version: number;
  body: string;
  by_kind: TermByKind;
  by_id: string | null;
  created_at: Date;
  space_id: string | null;
}
export type TermNew = Partial<TermRow> & Pick<TermRow, 'id' | 'kind' | 'version' | 'body' | 'by_kind'>;

/** community.topic_revisions */
export interface TopicRevisionRow {
  id: string;
  topic_id: string;
  seq: number;
  title: string;
  body: string;
  created_at: Date;
}
export type TopicRevisionNew = Partial<TopicRevisionRow> & Pick<TopicRevisionRow, 'id' | 'topic_id' | 'seq' | 'title' | 'body'>;

/** community.topics.state (값 목록 CHECK) */
export const TOPIC_STATE = ['shown', 'hidden', 'removed', 'deleted'] as const;
export type TopicState = (typeof TOPIC_STATE)[number];
/** community.topics.hidden_by (값 목록 CHECK) */
export const TOPIC_HIDDEN_BY = ['reports', 'owner'] as const;
export type TopicHiddenBy = (typeof TOPIC_HIDDEN_BY)[number];
/** community.topics */
export interface TopicRow {
  id: string;
  app_id: string;
  member_id: string;
  title: string;
  body: string;
  body_key: string;
  state: TopicState;
  revisions: number;
  request_id: string;
  created_at: Date;
  edited_at: Date | null;
  version: number;
  hidden_by: TopicHiddenBy | null;
  decided_at: Date | null;
}
export type TopicNew = Partial<TopicRow> & Pick<TopicRow, 'id' | 'app_id' | 'member_id' | 'title' | 'body' | 'body_key' | 'request_id'>;
