// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { TableColumns } from '../../../apps/server/src/plugin-api';

const { bigint, pgSchema, text, timestamp, uuid } = TableColumns;

const telegramSchema = pgSchema('telegram');

/** telegram.links */
export const links = telegramSchema.table('links', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  user_id: bigint('user_id', { mode: 'number' }).notNull(),
  chat_id: bigint('chat_id', { mode: 'number' }).notNull(),
  name: text('name').notNull(),
  current_chat: uuid('current_chat'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** telegram.pairings */
export const pairings = telegramSchema.table('pairings', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  code_hash: text('code_hash').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** telegram.threads */
export const threads = telegramSchema.table('threads', {
  chat_id: uuid('chat_id').notNull(),
  link_id: uuid('link_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});
