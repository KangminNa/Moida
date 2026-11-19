// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** community.comments.state (값 목록 CHECK) */
export const COMMENT_STATE = ['shown', 'hidden', 'removed', 'deleted'] as const;
export type CommentState = (typeof COMMENT_STATE)[number];
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
}
export type CommentNew = Partial<CommentRow> & Pick<CommentRow, 'id' | 'topic_id' | 'app_id' | 'member_id' | 'body' | 'body_key' | 'request_id'>;

/** community.member_sessions */
export interface MemberSessionRow {
  id: string;
  member_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_seen_at: Date | null;
  ended_at: Date | null;
}
export type MemberSessionNew = Partial<MemberSessionRow> & Pick<MemberSessionRow, 'id' | 'member_id' | 'token_hash' | 'expires_at'>;

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
  login_id: string;
  password_hash: string;
  password_changed_at: Date;
}
export type MemberNew = Partial<MemberRow> & Pick<MemberRow, 'id' | 'app_id' | 'nickname' | 'nickname_key' | 'age_confirmed_at' | 'login_id' | 'password_hash' | 'password_changed_at'>;

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
}
export type TopicNew = Partial<TopicRow> & Pick<TopicRow, 'id' | 'app_id' | 'member_id' | 'title' | 'body' | 'body_key' | 'request_id'>;
