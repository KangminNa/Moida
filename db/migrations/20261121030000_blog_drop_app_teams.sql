-- migrate:up
-- 앱 · 메뉴의 운영 팀을 없앤다 (2026-11-21 팀 없는 에이전트): 대표가 누구에게나 맡기고, 어느 에이전트나 앱 · 메뉴에 글을 놓는다.
-- 편집 방침(policy)은 그대로 둔다
ALTER TABLE blog.apps DROP COLUMN agent_id;
ALTER TABLE blog.menus DROP COLUMN agent_id;

-- migrate:down
ALTER TABLE blog.apps ADD COLUMN agent_id uuid;
ALTER TABLE blog.menus ADD COLUMN agent_id uuid;
