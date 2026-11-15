-- migrate:up
-- 보안 기록 (기획서 결정 2026-11-15 보안 화면): 로그인 · 로그아웃 · 비밀번호 · 설치 코드 · 기기 · 거부된 접근.
-- platform이 갖는다: 거부된 접근은 platform의 오류 필터에서 잡히고, 종류의 뜻은 기록하는 모듈이 정한다.
-- 같은 사건(공간 · 종류 · 곳 · 내용)이 1분 안에 또 오면 줄을 늘리지 않고 count · last_at만 올린다 (SecurityLog).
-- 비밀번호 · 토큰 · 쿠키 값은 어디에도 남기지 않는다. 90일 지난 줄은 일꾼이 지운다 (SecurityLogPurgeJob).
-- space_id: 공간을 모르는 사건(없는 아이디로 로그인, 로그인 전 거부)은 NULL. 공간이 하나라 관리자에게 함께 보인다.
-- place: 한 곳으로 세는 주소 (IPv4 그대로, IPv6는 /64. AttemptLimiter.place)
CREATE TABLE platform.security_events (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid,
  kind text NOT NULL CHECK (kind ~ '^[a-z]+(\.[a-z_]+)+$' AND char_length(kind) <= 60),
  ip text CHECK (char_length(ip) <= 64),
  place text CHECK (char_length(place) <= 64),
  user_agent text CHECK (char_length(user_agent) <= 200),
  detail jsonb NOT NULL DEFAULT '{}',
  count integer NOT NULL DEFAULT 1 CHECK (count >= 1),
  at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now()
);
-- 화면의 목록 (최근부터)과 1분 안의 같은 사건 찾기
CREATE INDEX security_events_list_idx ON platform.security_events (at DESC, id DESC);
CREATE INDEX security_events_merge_idx ON platform.security_events (kind, place, last_at);

-- 로그인 · 기기의 마지막 접근 (보안 화면). 프로세스마다 5분에 한 번만 적는다 (OwnerService.seen · DeviceService.seen)
-- 주소는 로그인할 때의 ip와 같은 inet (IP 모양이 아니면 적지 않는다)
ALTER TABLE account.web_sessions
  ADD COLUMN last_seen_at timestamptz,
  ADD COLUMN last_ip inet;
ALTER TABLE account.devices ADD COLUMN last_ip inet;

-- migrate:down
ALTER TABLE account.devices DROP COLUMN last_ip;
ALTER TABLE account.web_sessions DROP COLUMN last_ip, DROP COLUMN last_seen_at;
DROP TABLE platform.security_events;
