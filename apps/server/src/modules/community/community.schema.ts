// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { AppTableReadRule, AppTableWriteRule, CommentHiddenBy, CommentState, DecisionAction, DecisionByKind, ReportReason, ReportState, TermByKind, TermKind, TopicHiddenBy, TopicState } from './community.tables';

const communitySchema = pgSchema('community');

/** community.app_tables */
export const appTables = communitySchema.table('app_tables', {
  id: uuid('id').notNull(),
  app_id: uuid('app_id').notNull(),
  name: text('name').notNull(),
  columns: jsonb('columns').notNull(),
  read_rule: text('read_rule').$type<AppTableReadRule>().notNull(),
  write_rule: text('write_rule').$type<AppTableWriteRule>().notNull(),
  open: boolean('open').notNull(),
  applied_seq: integer('applied_seq').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull(),
  space_id: uuid('space_id').notNull(),
});

/** community.comments */
export const comments = communitySchema.table('comments', {
  id: uuid('id').notNull(),
  topic_id: uuid('topic_id').notNull(),
  app_id: uuid('app_id').notNull(),
  member_id: uuid('member_id').notNull(),
  body: text('body').notNull(),
  body_key: text('body_key').notNull(),
  state: text('state').$type<CommentState>().notNull(),
  request_id: text('request_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull(),
  hidden_by: text('hidden_by').$type<CommentHiddenBy>(),
  decided_at: timestamp('decided_at', { withTimezone: true }),
});

/** community.decisions */
export const decisions = communitySchema.table('decisions', {
  id: uuid('id').notNull(),
  app_id: uuid('app_id').notNull(),
  topic_id: uuid('topic_id'),
  comment_id: uuid('comment_id'),
  member_id: uuid('member_id'),
  action: text('action').$type<DecisionAction>().notNull(),
  by_kind: text('by_kind').$type<DecisionByKind>().notNull(),
  by_id: uuid('by_id'),
  note: text('note'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** community.member_sessions */
export const memberSessions = communitySchema.table('member_sessions', {
  id: uuid('id').notNull(),
  member_id: uuid('member_id').notNull(),
  token_hash: text('token_hash').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
  ended_at: timestamp('ended_at', { withTimezone: true }),
});

/** community.members */
export const members = communitySchema.table('members', {
  id: uuid('id').notNull(),
  app_id: uuid('app_id').notNull(),
  nickname: text('nickname').notNull(),
  nickname_key: text('nickname_key').notNull(),
  age_confirmed_at: timestamp('age_confirmed_at', { withTimezone: true }).notNull(),
  blocked_until: timestamp('blocked_until', { withTimezone: true }),
  block_note: text('block_note'),
  joined_at: timestamp('joined_at', { withTimezone: true }).notNull(),
  renamed_at: timestamp('renamed_at', { withTimezone: true }),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
  version: integer('version').notNull(),
  login_id: text('login_id'),
  password_hash: text('password_hash').notNull(),
  password_changed_at: timestamp('password_changed_at', { withTimezone: true }).notNull(),
  terms_version: integer('terms_version'),
  privacy_version: integer('privacy_version'),
  left_at: timestamp('left_at', { withTimezone: true }),
  email: text('email'),
});

/** community.reports */
export const reports = communitySchema.table('reports', {
  id: uuid('id').notNull(),
  app_id: uuid('app_id').notNull(),
  topic_id: uuid('topic_id'),
  comment_id: uuid('comment_id'),
  member_id: uuid('member_id').notNull(),
  reason: text('reason').$type<ReportReason>().notNull(),
  note: text('note'),
  state: text('state').$type<ReportState>().notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  closed_at: timestamp('closed_at', { withTimezone: true }),
  version: integer('version').notNull(),
});

/** community.terms */
export const terms = communitySchema.table('terms', {
  id: uuid('id').notNull(),
  app_id: uuid('app_id').notNull(),
  kind: text('kind').$type<TermKind>().notNull(),
  version: integer('version').notNull(),
  body: text('body').notNull(),
  by_kind: text('by_kind').$type<TermByKind>().notNull(),
  by_id: uuid('by_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** community.topic_revisions */
export const topicRevisions = communitySchema.table('topic_revisions', {
  id: uuid('id').notNull(),
  topic_id: uuid('topic_id').notNull(),
  seq: integer('seq').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** community.topics */
export const topics = communitySchema.table('topics', {
  id: uuid('id').notNull(),
  app_id: uuid('app_id').notNull(),
  member_id: uuid('member_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  body_key: text('body_key').notNull(),
  state: text('state').$type<TopicState>().notNull(),
  revisions: integer('revisions').notNull(),
  request_id: text('request_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  edited_at: timestamp('edited_at', { withTimezone: true }),
  version: integer('version').notNull(),
  hidden_by: text('hidden_by').$type<TopicHiddenBy>(),
  decided_at: timestamp('decided_at', { withTimezone: true }),
});
