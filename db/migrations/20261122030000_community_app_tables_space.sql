-- migrate:up
-- 앱 표의 목록에 공간을 적는다 (docs/스토어.md 12.4): 대화의 설정 제안(app_data)이 공간의 표를 읽고, 승인 뒤 그 공간의 표에만 넣는다.
-- 공개 여부와 상관없이 (비공개로 만드는 중인 앱의 표에도 내용을 넣는다). 이 표는 아직 빈 표다
ALTER TABLE community.app_tables ADD COLUMN space_id uuid NOT NULL;
CREATE INDEX app_tables_space ON community.app_tables (space_id, app_id, name);

-- migrate:down
DROP INDEX community.app_tables_space;
ALTER TABLE community.app_tables DROP COLUMN space_id;
