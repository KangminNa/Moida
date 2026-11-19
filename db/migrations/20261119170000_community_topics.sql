-- migrate:up
-- 커뮤니티의 글 · 글 버전 · 댓글 (스토어 3-1b, docs/스토어.md 11.5). 회원이 앱 도메인에서 쓴다.
-- 상태: shown(보임) · hidden(가림, 3-1c 신고 · 관리자) · removed(관리자가 내림, 3-1c) · deleted(쓴 회원이 지움).
-- 어느 상태든 내용과 버전은 남는다 (원칙 2). body_key: 같은 본문을 되풀이해 올리는지 보는 열쇠 (공백을 정리한 본문의 sha256)
CREATE TABLE community.topics (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  app_id      uuid NOT NULL,
  member_id   uuid NOT NULL REFERENCES community.members(id),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000),
  body_key    text NOT NULL CHECK (body_key ~ '^[0-9a-f]{64}$'),
  state       text NOT NULL DEFAULT 'shown' CHECK (state IN ('shown', 'hidden', 'removed', 'deleted')),
  revisions   integer NOT NULL DEFAULT 1 CHECK (revisions >= 1),
  request_id  text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT topics_request_key UNIQUE (member_id, request_id)
);
-- 목록(앱의 보이는 글, 최근부터) · 쓰기 한도(회원이 최근에 쓴 글)
CREATE INDEX topics_list ON community.topics (app_id, state, id DESC);
CREATE INDEX topics_member ON community.topics (member_id, created_at DESC);

-- 글의 버전: 제목 · 본문이 바뀔 때마다 하나, 추가만 한다 (원칙 2)
CREATE TABLE community.topic_revisions (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  topic_id    uuid NOT NULL REFERENCES community.topics(id),
  seq         integer NOT NULL CHECK (seq >= 1),
  title       text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topic_revisions_seq UNIQUE (topic_id, seq)
);
CREATE TRIGGER topic_revisions_append_only
  BEFORE UPDATE OR DELETE ON community.topic_revisions
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- 댓글: 고치지 않는다 (1차). 답글 없음
CREATE TABLE community.comments (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  topic_id    uuid NOT NULL REFERENCES community.topics(id),
  app_id      uuid NOT NULL,
  member_id   uuid NOT NULL REFERENCES community.members(id),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  body_key    text NOT NULL CHECK (body_key ~ '^[0-9a-f]{64}$'),
  state       text NOT NULL DEFAULT 'shown' CHECK (state IN ('shown', 'hidden', 'removed', 'deleted')),
  request_id  text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT comments_request_key UNIQUE (member_id, request_id)
);
CREATE INDEX comments_topic ON community.comments (topic_id, id);
CREATE INDEX comments_member ON community.comments (member_id, created_at DESC);

-- migrate:down
DROP TABLE community.comments;
DROP TABLE community.topic_revisions;
DROP TABLE community.topics;
