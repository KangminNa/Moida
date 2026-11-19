// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const communitySchema = pgSchema('community');

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
  login_id: text('login_id').notNull(),
  password_hash: text('password_hash').notNull(),
  password_changed_at: timestamp('password_changed_at', { withTimezone: true }).notNull(),
});
