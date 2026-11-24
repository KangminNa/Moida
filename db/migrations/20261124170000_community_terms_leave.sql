-- migrate:up
-- 스토어 3-4 (2026-11-24): 약관 · 가입 동의 · 탈퇴.
-- 약관: 앱마다 이용약관(terms) · 개인정보처리방침(privacy)의 버전. 추가만 한다 (지난 버전에 동의한 회원이 있다).
-- by_kind: owner(관리자가 콘솔에서) · approved(AI 제안을 관리자가 승인), by_id는 그 관리자
CREATE TABLE community.terms (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  app_id      uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('terms', 'privacy')),
  version     integer NOT NULL CHECK (version > 0),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 50000),
  by_kind     text NOT NULL CHECK (by_kind IN ('owner', 'approved')),
  by_id       uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT terms_version_key UNIQUE (app_id, kind, version)
);
CREATE TRIGGER terms_append_only
  BEFORE UPDATE OR DELETE ON community.terms
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- 회원: 가입할 때 동의한 약관 버전(3-4 전 가입은 null), 탈퇴한 때.
-- 탈퇴하면 개인정보를 지운다 (원칙 2의 예외): 아이디 · 비밀번호 해시 · 닉네임 · 차단 메모 · 마지막 접근.
-- 글 · 댓글 · 신고 · 결정 기록이 회원 id를 가리켜 줄은 남기고, 아이디는 'left:<id>', 해시는 '', 닉네임은 '탈퇴한 회원'(겹침 열쇠는 'left:<id>')
ALTER TABLE community.members
  ADD COLUMN terms_version integer CHECK (terms_version > 0),
  ADD COLUMN privacy_version integer CHECK (privacy_version > 0),
  ADD COLUMN left_at timestamptz,
  DROP CONSTRAINT members_login_id_check,
  DROP CONSTRAINT members_password_hash_check,
  ADD CONSTRAINT members_login_id_check CHECK (
    (left_at IS NULL AND login_id ~ '^[a-z][a-z0-9_]{3,19}$') OR (left_at IS NOT NULL AND login_id = 'left:' || id)),
  ADD CONSTRAINT members_password_hash_check CHECK (
    (left_at IS NULL AND password_hash LIKE 'scrypt$%') OR (left_at IS NOT NULL AND password_hash = ''));

-- migrate:down
ALTER TABLE community.members
  DROP CONSTRAINT members_password_hash_check,
  DROP CONSTRAINT members_login_id_check;
DELETE FROM community.member_sessions WHERE member_id IN (SELECT id FROM community.members WHERE left_at IS NOT NULL);
ALTER TABLE community.members
  ADD CONSTRAINT members_login_id_check CHECK (login_id ~ '^[a-z][a-z0-9_]{3,19}$') NOT VALID,
  ADD CONSTRAINT members_password_hash_check CHECK (password_hash LIKE 'scrypt$%') NOT VALID,
  DROP COLUMN left_at,
  DROP COLUMN privacy_version,
  DROP COLUMN terms_version;
DROP TABLE community.terms;
