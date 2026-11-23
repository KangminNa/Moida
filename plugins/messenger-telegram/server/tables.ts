// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** telegram.links */
export interface LinkRow {
  id: string;
  space_id: string;
  user_id: number;
  chat_id: number;
  name: string;
  current_chat: string | null;
  created_at: Date;
  updated_at: Date;
}
export type LinkNew = Partial<LinkRow> & Pick<LinkRow, 'id' | 'space_id' | 'user_id' | 'chat_id' | 'name'>;

/** telegram.pairings */
export interface PairingRow {
  id: string;
  space_id: string;
  code_hash: string;
  expires_at: Date;
  created_at: Date;
}
export type PairingNew = Partial<PairingRow> & Pick<PairingRow, 'id' | 'space_id' | 'code_hash' | 'expires_at'>;

/** telegram.threads */
export interface ThreadRow {
  chat_id: string;
  link_id: string;
  created_at: Date;
}
export type ThreadNew = Partial<ThreadRow> & Pick<ThreadRow, 'chat_id' | 'link_id'>;
