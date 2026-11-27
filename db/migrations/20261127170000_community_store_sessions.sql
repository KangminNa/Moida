-- migrate:up
-- 앱 없는 로그인 (2026-11-27, 공통 앱 도메인의 /_/login): 공통 앱 도메인(CAIRN_APPS_URL)에서는 회원 쿠키 하나를 모든 앱이 함께 써서
-- 앱을 고르지 않고 로그인한다. 그 세션은 앱이 없다 (app_id NULL). 앱마다의 도메인에서는 세션의 앱이 그 앱이어야 해서 이 세션은 통하지 않는다
ALTER TABLE community.account_sessions ALTER COLUMN app_id DROP NOT NULL;
COMMENT ON COLUMN community.account_sessions.app_id IS '로그인한 앱. NULL이면 공통 앱 도메인에서 앱 없이 연 로그인 (그 도메인에서만 통한다)';

-- migrate:down
DELETE FROM community.account_sessions WHERE app_id IS NULL;
ALTER TABLE community.account_sessions ALTER COLUMN app_id SET NOT NULL;
