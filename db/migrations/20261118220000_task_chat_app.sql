-- migrate:up
-- 대화의 앱 (스토어 2단계 2-2, docs/스토어.md 10장, 2026-11-18): 앱 관리의 "맡기기"로 연 대화가 그 앱을 가진다.
-- blog 앱의 id라 모듈 사이 외래키는 두지 않는다 (확인은 platform Lookups 'app'). 대표의 회차가 payload.chat.appId로 싣는다
ALTER TABLE task.chats ADD COLUMN app_id uuid;
-- 앱 관리의 "이 앱의 대화" 목록 (GET api/chats?app=, 최근 것부터)
CREATE INDEX chats_app_idx ON task.chats (space_id, app_id, updated_at DESC) WHERE app_id IS NOT NULL;

-- migrate:down
DROP INDEX task.chats_app_idx;
ALTER TABLE task.chats DROP COLUMN app_id;
