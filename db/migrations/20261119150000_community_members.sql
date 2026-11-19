-- migrate:up
-- 커뮤니티 회원 (스토어 3-1, docs/스토어.md 11장, 2026-11-19). 관리자 계정(account)과 표 · 쿠키 · 권한을 나눈다 (원칙 10).
-- 앱은 blog의 것이라 app_id는 값으로 둔다 (모듈 사이 외래키 없음). 회원은 앱마다 따로다: 같은 카카오 계정도 앱이 다르면 다른 회원.
-- 비밀번호 · 이메일 · IP는 저장하지 않는다 (최소 수집). 탈퇴하면 개인정보를 지운다 (원칙 2의 예외, 3-4)
CREATE SCHEMA community;

-- 회원. 닉네임은 앱 안에서 하나 (nickname_key: 소문자로 비교). age_confirmed_at: 가입할 때 만 14세 이상이라고 확인한 때.
-- blocked_until: 이때까지 쓰기 · 신고 · 닉네임 바꾸기를 막는다 (무기한은 9999-12-31). renamed_at: 닉네임을 마지막으로 바꾼 때
CREATE TABLE community.members (
  id                uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  app_id            uuid NOT NULL,
  nickname          text NOT NULL CHECK (char_length(nickname) BETWEEN 2 AND 20),
  nickname_key      text NOT NULL,
  age_confirmed_at  timestamptz NOT NULL,
  blocked_until     timestamptz,
  block_note        text CHECK (char_length(block_note) <= 500),
  joined_at         timestamptz NOT NULL DEFAULT now(),
  renamed_at        timestamptz,
  last_seen_at      timestamptz,
  version           integer NOT NULL DEFAULT 1,
  CONSTRAINT members_nickname_key UNIQUE (app_id, nickname_key)
);

-- 회원 로그인: 소셜 로그인(login 플러그인)의 방법과 그 서비스의 회원 번호. 서버 키를 바꿔도 로그인이 이어지도록 번호를 그대로 둔다
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

-- 회원 세션 (앱 도메인의 cairn_member 쿠키). 토큰 원문은 쿠키에만, 여기에는 해시만. 마지막으로 쓴 날부터 30일
CREATE TABLE community.member_sessions (
  id            uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  member_id     uuid NOT NULL REFERENCES community.members(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz,
  ended_at      timestamptz
);
CREATE INDEX member_sessions_member ON community.member_sessions (member_id);

-- migrate:down
DROP SCHEMA community CASCADE;
