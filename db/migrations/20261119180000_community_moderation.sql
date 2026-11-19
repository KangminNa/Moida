-- migrate:up
-- 커뮤니티 신고 · 임시 가림 · 관리자 결정 (스토어 3-1c, docs/스토어.md 11.5).
-- hidden_by: 가린 까닭 (reports: 신고가 3건 쌓여 시스템이, owner: 관리자가). 가려진(hidden) 글 · 댓글에만 있다.
-- decided_at: 관리자가 마지막으로 결정한 때. 이보다 앞선 신고는 임시 가림에 세지 않는다 (되돌린 뒤 옛 신고로 다시 가리지 않게)
ALTER TABLE community.topics
  ADD COLUMN hidden_by text CHECK (hidden_by IN ('reports', 'owner')),
  ADD COLUMN decided_at timestamptz,
  ADD CONSTRAINT topics_hidden_by CHECK ((state = 'hidden') = (hidden_by IS NOT NULL));
ALTER TABLE community.comments
  ADD COLUMN hidden_by text CHECK (hidden_by IN ('reports', 'owner')),
  ADD COLUMN decided_at timestamptz,
  ADD CONSTRAINT comments_hidden_by CHECK ((state = 'hidden') = (hidden_by IS NOT NULL));

-- 신고: 글이나 댓글 하나에 (둘 중 하나), 한 회원이 같은 것을 한 번만. 관리자가 결정하면 닫는다 (accepted: 내림, dismissed: 그대로 둠)
CREATE TABLE community.reports (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  app_id      uuid NOT NULL,
  topic_id    uuid REFERENCES community.topics(id),
  comment_id  uuid REFERENCES community.comments(id),
  member_id   uuid NOT NULL REFERENCES community.members(id),
  reason      text NOT NULL CHECK (reason IN ('spam', 'abuse', 'illegal', 'privacy', 'other')),
  note        text CHECK (char_length(note) <= 500),
  state       text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'accepted', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT reports_target CHECK ((topic_id IS NULL) <> (comment_id IS NULL)),
  CONSTRAINT reports_closed CHECK ((state = 'open') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX reports_once_topic ON community.reports (topic_id, member_id) WHERE topic_id IS NOT NULL;
CREATE UNIQUE INDEX reports_once_comment ON community.reports (comment_id, member_id) WHERE comment_id IS NOT NULL;
CREATE INDEX reports_open ON community.reports (app_id, id DESC) WHERE state = 'open';
CREATE INDEX reports_member ON community.reports (member_id, created_at DESC);

-- 관리자 결정 기록 (11.1 "관리자 결정 기록"): 추가만 한다. 대상은 글 · 댓글 · 회원 중 하나.
-- by_kind: system(신고로 임시 가림) · owner(관리자). 3-3에서 승인한 AI 운영 팀의 의견이면 approved를 더한다
CREATE TABLE community.decisions (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  app_id      uuid NOT NULL,
  topic_id    uuid REFERENCES community.topics(id),
  comment_id  uuid REFERENCES community.comments(id),
  member_id   uuid REFERENCES community.members(id),
  action      text NOT NULL CHECK (action IN ('hide', 'show', 'remove', 'block', 'unblock', 'reset_password')),
  by_kind     text NOT NULL CHECK (by_kind IN ('system', 'owner')),
  by_id       uuid,
  note        text CHECK (char_length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decisions_target CHECK (num_nonnulls(topic_id, comment_id, member_id) = 1)
);
CREATE INDEX decisions_app ON community.decisions (app_id, id DESC);
CREATE TRIGGER decisions_append_only
  BEFORE UPDATE OR DELETE ON community.decisions
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- migrate:down
DROP TABLE community.decisions;
DROP TABLE community.reports;
ALTER TABLE community.comments DROP CONSTRAINT comments_hidden_by, DROP COLUMN decided_at, DROP COLUMN hidden_by;
ALTER TABLE community.topics DROP CONSTRAINT topics_hidden_by, DROP COLUMN decided_at, DROP COLUMN hidden_by;
