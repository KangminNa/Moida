-- migrate:up
-- 일꾼의 화면 읽기에 화면 그림 (2026-11-25, 스토어 14장 A2): 앱의 디자인 조사가 참고할 화면을 그림으로 본다.
-- want_shot: browser_read의 shot: true. 러너가 첫 화면(1280×900)을 JPEG로 떠서 shot에 남긴다 (MCP 본문 한도 때문에 280KB까지)
ALTER TABLE browser_tabs.reads ADD COLUMN want_shot boolean NOT NULL DEFAULT false;
ALTER TABLE browser_tabs.reads ADD COLUMN shot bytea CHECK (octet_length(shot) <= 286720);

-- migrate:down
ALTER TABLE browser_tabs.reads DROP COLUMN shot;
ALTER TABLE browser_tabs.reads DROP COLUMN want_shot;
