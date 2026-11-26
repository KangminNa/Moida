-- migrate:up
-- 기능 패키지 email의 자기 스키마 (2026-11-26, 앱 소식 메일 구독). 코어 표에 외래키를 걸지 않는다 (app_id · post_id · space_id는 값으로만)
CREATE SCHEMA email;

-- 구독자: 방문자가 스토어 첫 화면에서 넣은 주소와 앱. 확인 메일의 링크를 눌러야 active가 된다 (두 번 확인).
-- token: 확인 · 해지 링크의 열쇠 (한 번의 신청에 하나, 그 신청의 앱들이 함께 쓴다). 메일마다 해지 링크에 넣어야 해서 그대로 둔다
-- (새어도 할 수 있는 일은 그 구독의 확인 · 해지뿐이다). 해지하면 줄을 바로 지운다 (개인정보, 원칙 2 예외)
CREATE TABLE email.subscribers (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  app_id uuid NOT NULL,
  app_name text NOT NULL CHECK (char_length(app_name) BETWEEN 1 AND 100),
  address text NOT NULL CHECK (char_length(address) BETWEEN 3 AND 254 AND address = lower(address)),
  status text NOT NULL CHECK (status IN ('pending', 'active')),
  token text NOT NULL CHECK (token ~ '^[A-Za-z0-9_-]{43}$'),
  -- 확인 메일을 보낸 때. null이면 일꾼이 보낼 차례
  confirm_sent_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, address)
);
CREATE INDEX subscribers_token_idx ON email.subscribers (token);
CREATE INDEX subscribers_app_idx ON email.subscribers (app_id, status);

-- 소식 한 번: 앱의 글 하나가 공개되면 ready로 생기고, 관리자가 콘솔에서 보내기를 누르면 sending (원칙 7: 바깥 전송은 사람이 정한다)
CREATE TABLE email.sends (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  app_id uuid NOT NULL,
  app_name text NOT NULL,
  post_id uuid NOT NULL UNIQUE,
  title text NOT NULL,
  link text NOT NULL,
  status text NOT NULL CHECK (status IN ('ready', 'sending', 'done', 'cancelled')),
  total integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX sends_space_idx ON email.sends (space_id, created_at DESC);

-- 받는 사람 한 명 몫. 일꾼이 sending으로 잡고(claimed_at) 보낸 뒤 sent · failed로 적는다.
-- 잡은 채 10분이 지나면 보냈는지 모르는 채 failed로 둔다 (두 번 가는 것보다 빠지는 것이 낫다)
CREATE TABLE email.deliveries (
  send_id uuid NOT NULL REFERENCES email.sends (id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  error text CHECK (char_length(error) <= 300),
  claimed_at timestamptz,
  sent_at timestamptz,
  PRIMARY KEY (send_id, subscriber_id)
);
CREATE INDEX deliveries_status_idx ON email.deliveries (status, claimed_at);

-- migrate:down
DROP SCHEMA email CASCADE;
