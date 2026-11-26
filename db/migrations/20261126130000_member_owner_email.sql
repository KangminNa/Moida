-- migrate:up
-- 메일 인증 가입 (2026-11-26, 기획서 결정): 회원은 메일로 받은 인증코드로 가입하고 메일 + 비밀번호로 로그인한다.
-- 메일 주소는 앱 안에서 하나 (소문자로 둔다). 전에 아이디로 가입한 회원은 아이디로 그대로 로그인한다 (login_id가 있고 email은 null).
-- 메일로 가입한 회원은 아이디가 없다 (login_id null). 탈퇴하면 메일도 지운다 (원칙 2의 예외: 개인정보보호법)
ALTER TABLE community.members
  ADD COLUMN email text CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  ALTER COLUMN login_id DROP NOT NULL,
  DROP CONSTRAINT members_login_id_check,
  ADD CONSTRAINT members_login_id_check CHECK (
    (left_at IS NULL AND (coalesce(login_id ~ '^[a-z][a-z0-9_]{3,19}$', false) OR (login_id IS NULL AND email IS NOT NULL)))
    OR (left_at IS NOT NULL AND login_id = 'left:' || id AND email IS NULL));
CREATE UNIQUE INDEX members_email_key ON community.members (app_id, email) WHERE email IS NOT NULL;

-- 관리자 계정: 설치 때 아이디 대신 메일 주소로 만든다 (login 칸에 메일을 둔다, 소문자). 전에 만든 아이디는 그대로 쓴다
ALTER TABLE account.users
  DROP CONSTRAINT users_login_check,
  ADD CONSTRAINT users_login_check CHECK (
    login ~ '^[a-z0-9_-]{3,40}$'
    OR (char_length(login) <= 254 AND login = lower(login) AND login ~ '^[^\s@]{1,64}@[^\s@]+\.[^\s@.]+$'));

-- migrate:down
ALTER TABLE account.users
  DROP CONSTRAINT users_login_check,
  ADD CONSTRAINT users_login_check CHECK (login ~ '^[a-z0-9_-]{3,40}$') NOT VALID;
DROP INDEX community.members_email_key;
ALTER TABLE community.members
  DROP CONSTRAINT members_login_id_check,
  ADD CONSTRAINT members_login_id_check CHECK (
    (left_at IS NULL AND login_id ~ '^[a-z][a-z0-9_]{3,19}$') OR (left_at IS NOT NULL AND login_id = 'left:' || id)) NOT VALID,
  DROP COLUMN email;
