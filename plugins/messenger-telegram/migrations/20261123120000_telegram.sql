-- migrate:up
-- 기능 패키지 messenger-telegram의 자기 스키마 (2026-11-23, 텔레그램으로 대화하기). 코어 표에 외래키를 걸지 않는다 (space_id · chat_id는 값으로만)
CREATE SCHEMA telegram;

-- 연결 코드: 관리자가 콘솔에서 받아 봇에게 보낸다. 코드는 sha256만 둔다. 10분, 한 번만 (쓰면 지운다)
CREATE TABLE telegram.pairings (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pairings_space_idx ON telegram.pairings (space_id);

-- 이어 둔 텔레그램 계정. 이 계정이 봇에게 보낸 말만 관리자의 말로 받는다 (다른 사람의 말은 버린다)
CREATE TABLE telegram.links (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  user_id bigint NOT NULL UNIQUE,
  -- 봇과의 1:1 대화 (답을 보낼 곳)
  chat_id bigint NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  -- 지금 이어 말하는 Cairn 대화. 없으면 다음 말이 새 대화를 연다 (/new)
  current_chat uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX links_space_idx ON telegram.links (space_id, id DESC);

-- 텔레그램에서 연 · 이어 말한 Cairn 대화 → 답을 돌려보낼 계정. 연결을 끊으면 함께 지운다
CREATE TABLE telegram.threads (
  chat_id uuid PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES telegram.links(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX threads_link_idx ON telegram.threads (link_id);

-- migrate:down
DROP TABLE telegram.threads;
DROP TABLE telegram.links;
DROP TABLE telegram.pairings;
DROP SCHEMA telegram;
