// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** email.deliveries.status (값 목록 CHECK) */
export const DELIVERY_STATUS = ['queued', 'sending', 'sent', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS)[number];
/** email.deliveries */
export interface DeliveryRow {
  send_id: string;
  subscriber_id: string;
  status: DeliveryStatus;
  error: string | null;
  claimed_at: Date | null;
  sent_at: Date | null;
}
export type DeliveryNew = Partial<DeliveryRow> & Pick<DeliveryRow, 'send_id' | 'subscriber_id' | 'status'>;

/** email.sends.status (값 목록 CHECK) */
export const SEND_STATUS = ['draft', 'ready', 'sending', 'done', 'cancelled'] as const;
export type SendStatus = (typeof SEND_STATUS)[number];
/** email.sends.kind (값 목록 CHECK) */
export const SEND_KIND = ['post', 'news'] as const;
export type SendKind = (typeof SEND_KIND)[number];
/** email.sends */
export interface SendRow {
  id: string;
  space_id: string;
  app_id: string | null;
  app_name: string | null;
  post_id: string | null;
  title: string;
  link: string | null;
  status: SendStatus;
  total: number;
  sent: number;
  failed: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  kind: SendKind;
  body: string | null;
  request_id: string | null;
  approval_id: string | null;
}
export type SendNew = Partial<SendRow> & Pick<SendRow, 'id' | 'space_id' | 'title' | 'status'>;

/** email.subscribers.status (값 목록 CHECK) */
export const SUBSCRIBER_STATUS = ['pending', 'active'] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUS)[number];
/** email.subscribers */
export interface SubscriberRow {
  id: string;
  app_id: string | null;
  app_name: string | null;
  address: string;
  status: SubscriberStatus;
  token: string;
  confirm_sent_at: Date | null;
  confirmed_at: Date | null;
  created_at: Date;
  space_id: string | null;
  account_id: string | null;
}
export type SubscriberNew = Partial<SubscriberRow> & Pick<SubscriberRow, 'id' | 'address' | 'status' | 'token'>;

/** email.usage.kind (값 목록 CHECK) */
export const USAGE_KIND = ['code', 'notice', 'answer', 'test', 'confirm', 'post', 'news'] as const;
export type UsageKind = (typeof USAGE_KIND)[number];
/** email.usage */
export interface UsageRow {
  day: string;
  kind: UsageKind;
  sent: number;
  blocked: number;
}
export type UsageNew = Partial<UsageRow> & Pick<UsageRow, 'day' | 'kind'>;
