// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** community.member_logins */
export interface MemberLoginRow {
  id: string;
  member_id: string;
  app_id: string;
  method: string;
  subject: string;
  created_at: Date;
}
export type MemberLoginNew = Partial<MemberLoginRow> & Pick<MemberLoginRow, 'id' | 'member_id' | 'app_id' | 'method' | 'subject'>;

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
}
export type MemberNew = Partial<MemberRow> & Pick<MemberRow, 'id' | 'app_id' | 'nickname' | 'nickname_key' | 'age_confirmed_at'>;
