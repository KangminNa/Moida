// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { TableColumns } from '../../../apps/server/src/plugin-api';

const { customType, integer, pgSchema, text, timestamp, uuid } = TableColumns;
import type { DeliveryStatus, SendKind, SendStatus, SubscriberStatus, UsageKind } from './tables';

const dateColumn = customType<{ data: string }>({ dataType: () => 'date' });
const emailSchema = pgSchema('email');

/** email.deliveries */
export const deliveries = emailSchema.table('deliveries', {
  send_id: uuid('send_id').notNull(),
  subscriber_id: uuid('subscriber_id').notNull(),
  status: text('status').$type<DeliveryStatus>().notNull(),
  error: text('error'),
  claimed_at: timestamp('claimed_at', { withTimezone: true }),
  sent_at: timestamp('sent_at', { withTimezone: true }),
});

/** email.sends */
export const sends = emailSchema.table('sends', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  app_id: uuid('app_id'),
  app_name: text('app_name'),
  post_id: uuid('post_id'),
  title: text('title').notNull(),
  link: text('link'),
  status: text('status').$type<SendStatus>().notNull(),
  total: integer('total').notNull(),
  sent: integer('sent').notNull(),
  failed: integer('failed').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  started_at: timestamp('started_at', { withTimezone: true }),
  finished_at: timestamp('finished_at', { withTimezone: true }),
  kind: text('kind').$type<SendKind>().notNull(),
  body: text('body'),
  request_id: text('request_id'),
  approval_id: uuid('approval_id'),
});

/** email.subscribers */
export const subscribers = emailSchema.table('subscribers', {
  id: uuid('id').notNull(),
  app_id: uuid('app_id'),
  app_name: text('app_name'),
  address: text('address').notNull(),
  status: text('status').$type<SubscriberStatus>().notNull(),
  token: text('token').notNull(),
  confirm_sent_at: timestamp('confirm_sent_at', { withTimezone: true }),
  confirmed_at: timestamp('confirmed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  space_id: uuid('space_id'),
  account_id: uuid('account_id'),
});

/** email.usage */
export const usage = emailSchema.table('usage', {
  day: dateColumn('day').notNull(),
  kind: text('kind').$type<UsageKind>().notNull(),
  sent: integer('sent').notNull(),
  blocked: integer('blocked').notNull(),
});
