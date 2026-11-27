-- migrate:up
-- 가입자 소식 메일 (2026-11-27, 사용자 "가입자 전원인데 애초에 회원가입할 때 받아" · "보낼 때마다 승인").
-- 받는 사람: 가입 때(또는 내 정보에서) 소식 메일을 받기로 한 스토어 계정. 코어가 동의를 알리면(community.account.news)
--   주소를 묻고(lookup news-address) 줄 하나를 둔다. 앱 구독과 달리 앱이 없고 공간에 하나다 (account_id, space_id).
--   이미 동의를 확인했으니 확인 메일 없이 active로 둔다. 해지 · 탈퇴 · 동의 철회면 줄을 바로 지운다 (개인정보)
ALTER TABLE email.subscribers
  ADD COLUMN space_id uuid,
  ADD COLUMN account_id uuid,
  ALTER COLUMN app_id DROP NOT NULL,
  ALTER COLUMN app_name DROP NOT NULL,
  ADD CONSTRAINT subscribers_account_or_app CHECK (
    (account_id IS NULL AND app_id IS NOT NULL AND app_name IS NOT NULL)
    OR (account_id IS NOT NULL AND app_id IS NULL AND space_id IS NOT NULL AND status = 'active'));
CREATE UNIQUE INDEX subscribers_account_idx ON email.subscribers (account_id) WHERE account_id IS NOT NULL;
-- 소식 메일을 보낼 때 공간의 계정 수신자를 고른다
CREATE INDEX subscribers_space_idx ON email.subscribers (space_id) WHERE account_id IS NOT NULL;

-- 소식(news): 대표가 쓴 메일 한 통(제목 · 본문). draft로 생기고 결재(email.news.send)가 승인되면 sending (원칙 7).
-- 글 소식(post)과 같은 대기열 · 하루 상한으로 나간다. request_id: 같은 요청이 두 번 와도 한 통
ALTER TABLE email.sends
  ADD COLUMN kind text NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'news')),
  ADD COLUMN body text CHECK (char_length(body) <= 20000),
  ADD COLUMN request_id text CHECK (char_length(request_id) <= 200),
  ADD COLUMN approval_id uuid,
  ALTER COLUMN post_id DROP NOT NULL,
  ALTER COLUMN app_id DROP NOT NULL,
  ALTER COLUMN app_name DROP NOT NULL,
  ALTER COLUMN link DROP NOT NULL,
  DROP CONSTRAINT sends_status_check,
  ADD CONSTRAINT sends_status_check CHECK (status IN ('draft', 'ready', 'sending', 'done', 'cancelled')),
  ADD CONSTRAINT sends_kind_fields CHECK (
    (kind = 'post' AND post_id IS NOT NULL AND app_id IS NOT NULL AND app_name IS NOT NULL AND link IS NOT NULL)
    OR (kind = 'news' AND post_id IS NULL AND body IS NOT NULL AND request_id IS NOT NULL));
CREATE UNIQUE INDEX sends_request_idx ON email.sends (space_id, request_id) WHERE request_id IS NOT NULL;

-- migrate:down
DROP INDEX email.sends_request_idx;
DELETE FROM email.sends WHERE kind = 'news';
ALTER TABLE email.sends
  DROP CONSTRAINT sends_kind_fields,
  DROP CONSTRAINT sends_status_check,
  ADD CONSTRAINT sends_status_check CHECK (status IN ('ready', 'sending', 'done', 'cancelled')),
  ALTER COLUMN link SET NOT NULL,
  ALTER COLUMN app_name SET NOT NULL,
  ALTER COLUMN app_id SET NOT NULL,
  ALTER COLUMN post_id SET NOT NULL,
  DROP COLUMN approval_id,
  DROP COLUMN request_id,
  DROP COLUMN body,
  DROP COLUMN kind;
DROP INDEX email.subscribers_space_idx;
DROP INDEX email.subscribers_account_idx;
DELETE FROM email.deliveries d USING email.subscribers p
  WHERE d.subscriber_id = p.id AND p.account_id IS NOT NULL;
DELETE FROM email.subscribers WHERE account_id IS NOT NULL;
ALTER TABLE email.subscribers
  DROP CONSTRAINT subscribers_account_or_app,
  ALTER COLUMN app_name SET NOT NULL,
  ALTER COLUMN app_id SET NOT NULL,
  DROP COLUMN account_id,
  DROP COLUMN space_id;
