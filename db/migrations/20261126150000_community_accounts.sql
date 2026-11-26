-- migrate:up
-- 스토어 계정 (2026-11-26, 기획서 결정): 회원은 앱마다 가입하지 않고 공간(스토어)에 계정 하나로 가입한다.
-- 계정(accounts)이 메일 · 아이디 · 비밀번호 · 공통 약관 동의를 갖고, 앱의 회원(members)은 그 계정의 "앱 참여"다
-- (닉네임 · 차단 · 글 · 앱 데이터의 owner는 지금처럼 앱마다). 로그인은 앱 도메인마다 따로다 (쿠키가 그 도메인에만 실린다).
-- 계정 탈퇴는 개인정보(메일 · 아이디 · 비밀번호 해시 · 마지막 접근)를 지우고 줄은 남긴다 (원칙 2의 예외: 개인정보보호법).
-- suspended_until: 관리자의 계정 정지 (이때까지 로그인을 막는다, 무기한은 9999-12-31)
CREATE TABLE community.accounts (
  id                   uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id             uuid NOT NULL,
  login_id             text CHECK (login_id ~ '^[a-z][a-z0-9_]{3,19}$'),
  email                text CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  password_hash        text NOT NULL,
  password_changed_at  timestamptz NOT NULL,
  age_confirmed_at     timestamptz NOT NULL,
  terms_version        integer CHECK (terms_version > 0),
  privacy_version      integer CHECK (privacy_version > 0),
  suspended_until      timestamptz,
  joined_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz,
  left_at              timestamptz,
  version              integer NOT NULL DEFAULT 1,
  CONSTRAINT accounts_state_check CHECK (
    (left_at IS NULL AND password_hash LIKE 'scrypt$%' AND (login_id IS NOT NULL OR email IS NOT NULL))
    OR (left_at IS NOT NULL AND login_id IS NULL AND email IS NULL AND password_hash = ''))
);
CREATE UNIQUE INDEX accounts_login_key ON community.accounts (space_id, login_id) WHERE login_id IS NOT NULL;
CREATE UNIQUE INDEX accounts_email_key ON community.accounts (space_id, email) WHERE email IS NOT NULL;

ALTER TABLE community.members ADD COLUMN account_id uuid REFERENCES community.accounts(id);

-- 기존 회원 옮기기. 앱이 든 공간은 이 한 번만 blog.apps에서 읽는다 (코드는 다른 모듈 표를 읽지 않는다).
-- 메일로 가입한 회원: 공간 · 메일마다 계정 하나 (여러 앱에 같은 메일이면 합치고, 비밀번호는 가장 최근에 정한 것)
INSERT INTO community.accounts
  (space_id, email, password_hash, password_changed_at, age_confirmed_at, joined_at, last_seen_at)
SELECT DISTINCT ON (a.space_id, m.email)
  a.space_id, m.email, m.password_hash, m.password_changed_at,
  min(m.age_confirmed_at) OVER w, min(m.joined_at) OVER w, max(m.last_seen_at) OVER w
FROM community.members m JOIN blog.apps a ON a.id = m.app_id
WHERE m.left_at IS NULL AND m.email IS NOT NULL
WINDOW w AS (PARTITION BY a.space_id, m.email)
ORDER BY a.space_id, m.email, m.password_changed_at DESC;
UPDATE community.members m SET account_id = c.id
FROM blog.apps a, community.accounts c
WHERE a.id = m.app_id AND c.space_id = a.space_id AND c.email = m.email AND m.left_at IS NULL;

-- 아이디로 가입한 회원 (메일 없음): 회원마다 계정 하나. 다른 앱에 같은 아이디가 있으면 나중에 가입한 쪽 아이디 뒤에 표시를 붙인다
CREATE TEMP TABLE legacy_accounts ON COMMIT DROP AS
SELECT m.id AS member_id, platform.uuid_v7() AS account_id, a.space_id,
  CASE WHEN row_number() OVER (PARTITION BY a.space_id, m.login_id ORDER BY m.joined_at, m.id) = 1 THEN m.login_id
       ELSE left(m.login_id, 12) || '_' || substr(md5(m.id::text), 1, 6) END AS login_id,
  m.password_hash, m.password_changed_at, m.age_confirmed_at, m.joined_at, m.last_seen_at
FROM community.members m JOIN blog.apps a ON a.id = m.app_id
WHERE m.left_at IS NULL AND m.email IS NULL;
INSERT INTO community.accounts
  (id, space_id, login_id, password_hash, password_changed_at, age_confirmed_at, joined_at, last_seen_at)
SELECT account_id, space_id, login_id, password_hash, password_changed_at, age_confirmed_at, joined_at, last_seen_at
FROM legacy_accounts;
UPDATE community.members m SET account_id = l.account_id FROM legacy_accounts l WHERE l.member_id = m.id;

-- 로그인은 계정의 것이고 앱 도메인마다 따로다: 세션이 계정과 그 앱을 가리킨다 (앱에 참여하기 전에도 로그인할 수 있다)
ALTER TABLE community.member_sessions RENAME TO account_sessions;
ALTER INDEX community.member_sessions_pkey RENAME TO account_sessions_pkey;
ALTER INDEX community.member_sessions_token_hash_key RENAME TO account_sessions_token_hash_key;
ALTER TABLE community.account_sessions
  ADD COLUMN account_id uuid REFERENCES community.accounts(id) ON DELETE CASCADE,
  ADD COLUMN app_id uuid;
UPDATE community.account_sessions s SET account_id = m.account_id, app_id = m.app_id
FROM community.members m WHERE m.id = s.member_id;
DELETE FROM community.account_sessions WHERE account_id IS NULL;
ALTER TABLE community.account_sessions
  ALTER COLUMN account_id SET NOT NULL,
  ALTER COLUMN app_id SET NOT NULL,
  DROP COLUMN member_id;
CREATE INDEX account_sessions_account ON community.account_sessions (account_id);

-- 회원(앱 참여)에서 메일 · 아이디 · 비밀번호를 뺀다 (계정으로 옮겼다). 앱에서 나가면 계정과의 연결도 끊는다 (account_id null)
DROP INDEX community.members_email_key;
ALTER TABLE community.members
  DROP CONSTRAINT members_login_key,
  DROP CONSTRAINT members_login_id_check,
  DROP CONSTRAINT members_password_hash_check,
  DROP COLUMN login_id,
  DROP COLUMN email,
  DROP COLUMN password_hash,
  DROP COLUMN password_changed_at,
  ADD CONSTRAINT members_account_check CHECK (
    (left_at IS NULL AND account_id IS NOT NULL)
    OR (left_at IS NOT NULL AND account_id IS NULL AND nickname_key = 'left:' || id));
CREATE UNIQUE INDEX members_account_key ON community.members (app_id, account_id) WHERE account_id IS NOT NULL;
CREATE INDEX members_account ON community.members (account_id);

-- 공통 약관: 공간(스토어)의 이용약관 · 개인정보처리방침 (app_id null, space_id). 앱의 약관(app_id)은 그 앱에 참여할 때 더 동의하는 것
ALTER TABLE community.terms
  ALTER COLUMN app_id DROP NOT NULL,
  ADD COLUMN space_id uuid,
  ADD CONSTRAINT terms_owner_check CHECK (num_nonnulls(app_id, space_id) = 1);
CREATE UNIQUE INDEX terms_store_version_key ON community.terms (space_id, kind, version) WHERE space_id IS NOT NULL;

-- migrate:down
ALTER TABLE community.terms DISABLE TRIGGER terms_append_only;
DELETE FROM community.terms WHERE app_id IS NULL;
ALTER TABLE community.terms ENABLE TRIGGER terms_append_only;
DROP INDEX community.terms_store_version_key;
ALTER TABLE community.terms
  DROP CONSTRAINT terms_owner_check,
  DROP COLUMN space_id,
  ALTER COLUMN app_id SET NOT NULL;

DROP INDEX community.members_account;
DROP INDEX community.members_account_key;
ALTER TABLE community.members
  DROP CONSTRAINT members_account_check,
  ADD COLUMN login_id text,
  ADD COLUMN email text CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  ADD COLUMN password_hash text,
  ADD COLUMN password_changed_at timestamptz;
UPDATE community.members m
SET login_id = c.login_id, email = c.email, password_hash = c.password_hash, password_changed_at = c.password_changed_at
FROM community.accounts c WHERE c.id = m.account_id;
UPDATE community.members SET login_id = 'left:' || id, password_hash = '', password_changed_at = joined_at
WHERE left_at IS NOT NULL;
ALTER TABLE community.members
  ALTER COLUMN password_hash SET NOT NULL,
  ALTER COLUMN password_changed_at SET NOT NULL,
  ADD CONSTRAINT members_login_key UNIQUE (app_id, login_id),
  ADD CONSTRAINT members_login_id_check CHECK (
    (left_at IS NULL AND (coalesce(login_id ~ '^[a-z][a-z0-9_]{3,19}$', false) OR (login_id IS NULL AND email IS NOT NULL)))
    OR (left_at IS NOT NULL AND login_id = 'left:' || id AND email IS NULL)) NOT VALID,
  ADD CONSTRAINT members_password_hash_check CHECK (
    (left_at IS NULL AND password_hash LIKE 'scrypt$%') OR (left_at IS NOT NULL AND password_hash = '')) NOT VALID;
CREATE UNIQUE INDEX members_email_key ON community.members (app_id, email) WHERE email IS NOT NULL;

ALTER TABLE community.account_sessions
  ADD COLUMN member_id uuid REFERENCES community.members(id) ON DELETE CASCADE;
UPDATE community.account_sessions s SET member_id = m.id
FROM community.members m WHERE m.account_id = s.account_id AND m.app_id = s.app_id;
DELETE FROM community.account_sessions WHERE member_id IS NULL;
DROP INDEX community.account_sessions_account;
ALTER TABLE community.account_sessions
  ALTER COLUMN member_id SET NOT NULL,
  DROP COLUMN account_id,
  DROP COLUMN app_id;
ALTER INDEX community.account_sessions_token_hash_key RENAME TO member_sessions_token_hash_key;
ALTER INDEX community.account_sessions_pkey RENAME TO member_sessions_pkey;
ALTER TABLE community.account_sessions RENAME TO member_sessions;
CREATE INDEX member_sessions_member ON community.member_sessions (member_id);

ALTER TABLE community.members DROP COLUMN account_id;
DROP TABLE community.accounts;
