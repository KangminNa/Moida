-- migrate:up
-- 앱별 운영 (스토어 2단계 2-1, docs/스토어.md 10장, 2026-11-18)
-- agent_id: 운영 팀장 (task의 맨 위 에이전트, 값이라 외래키 없음). 운영 팀은 팀장과 그 아래 팀 전체 (blog AppTeam)
-- policy: 편집 방침 (이 앱에 쓰는 AI가 읽는다, 메뉴의 방침과 같은 한도)
-- home: 방문자 첫 화면(/)으로 고정한 앱. 공간마다 하나, 공개 앱만
ALTER TABLE blog.apps
  ADD COLUMN agent_id uuid,
  ADD COLUMN policy text NOT NULL DEFAULT '' CHECK (char_length(policy) <= 4000),
  ADD COLUMN home boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT apps_home_public CHECK (NOT home OR visibility = 'public');
-- 첫 화면 고정은 공간마다 하나 (PUT api/apps/home이 다른 앱의 고정을 풀고 건다)
CREATE UNIQUE INDEX apps_one_home ON blog.apps (space_id) WHERE home;

-- migrate:down
DROP INDEX blog.apps_one_home;
ALTER TABLE blog.apps
  DROP CONSTRAINT apps_home_public,
  DROP COLUMN home,
  DROP COLUMN policy,
  DROP COLUMN agent_id;
