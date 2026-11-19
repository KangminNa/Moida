-- migrate:up
-- 커뮤니티 회원 가입을 아이디 · 비밀번호로 바꾼다 (스토어 3-1, 2026-11-19 사용자 결정: 소셜 로그인 대신 간단한 가입).
-- 소셜 로그인의 회원 번호 표(member_logins)는 쓰지 않는다. 3-1a의 회원은 배포 전 개발 · 테스트 DB에만 있었고
-- 비밀번호가 없어 로그인할 수 없으므로 지운다 (세션은 외래키로 함께 지워진다)
DROP TABLE community.member_logins;
DELETE FROM community.members;

-- login_id: 앱 안에서 하나, 영문 소문자로 시작하는 4~20자 (영문 소문자 · 숫자 · _, 받은 값을 소문자로 바꿔 둔다).
-- password_hash: platform PasswordHasher(scrypt)의 값. password_changed_at: 비밀번호를 정하거나 바꾼 때
ALTER TABLE community.members
  ADD COLUMN login_id text NOT NULL CHECK (login_id ~ '^[a-z][a-z0-9_]{3,19}$'),
  ADD COLUMN password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  ADD COLUMN password_changed_at timestamptz NOT NULL,
  ADD CONSTRAINT members_login_key UNIQUE (app_id, login_id);

-- migrate:down
DELETE FROM community.members;
ALTER TABLE community.members
  DROP CONSTRAINT members_login_key,
  DROP COLUMN password_changed_at,
  DROP COLUMN password_hash,
  DROP COLUMN login_id;
CREATE TABLE community.member_logins (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  member_id   uuid NOT NULL REFERENCES community.members(id) ON DELETE CASCADE,
  app_id      uuid NOT NULL,
  method      text NOT NULL CHECK (method ~ '^[a-z0-9-]{1,40}$'),
  subject     text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_logins_subject_key UNIQUE (app_id, method, subject)
);
CREATE INDEX member_logins_member ON community.member_logins (member_id);
