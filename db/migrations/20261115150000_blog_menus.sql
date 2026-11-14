-- migrate:up
-- 2차 6단계 블로그 메뉴 (서브나 9장): 아직 쓰지 않던 카테고리(blog.categories)를 메뉴로 바꿔 넓힌다.
-- 메뉴 종류: posts(글 목록) · issues(호 목록, 매거진) · pages(페이지 모음) · page(페이지 하나).
-- 글 · 페이지는 menu_id로 메뉴에 올라간다. 올린 것은 공개 대기이고, 공개는 글의 공개 범위 · 페이지의 공개로 정한다.
-- policy: 편집 방침 (메뉴에 쓰는 AI가 읽는다), agent_id: 운영 팀 (task의 에이전트, 값이라 외래키 없음), rss: 메뉴의 RSS
ALTER TABLE blog.categories RENAME TO menus;
ALTER TABLE blog.menus RENAME CONSTRAINT categories_pkey TO menus_pkey;
DROP INDEX blog.categories_tree_idx;
DROP INDEX blog.categories_parent_idx;
ALTER TABLE blog.menus DROP CONSTRAINT categories_space_id_parent_id_slug_key;
ALTER TABLE blog.menus DROP COLUMN parent_id, DROP COLUMN deleted_at;
ALTER TABLE blog.menus
  ADD COLUMN kind text NOT NULL DEFAULT 'posts' CHECK (kind IN ('posts', 'issues', 'pages', 'page')),
  ADD COLUMN policy text NOT NULL DEFAULT '' CHECK (char_length(policy) <= 4000),
  ADD COLUMN agent_id uuid,
  ADD COLUMN rss boolean NOT NULL DEFAULT true,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT menus_name_check CHECK (char_length(name) BETWEEN 1 AND 40),
  ADD CONSTRAINT menus_slug_check CHECK (char_length(slug) BETWEEN 1 AND 60),
  ADD CONSTRAINT menus_space_id_slug_key UNIQUE (space_id, slug);
-- 메뉴 줄의 순서
CREATE INDEX menus_order_idx ON blog.menus (space_id, sort, created_at);

-- 글의 카테고리 칸이 메뉴 칸이 된다 (외래키 · 색인도 이름만 바꾼다. 공개 목록 색인은 그대로 메뉴 칸을 싣는다)
ALTER TABLE blog.posts RENAME COLUMN category_id TO menu_id;
ALTER TABLE blog.posts RENAME CONSTRAINT posts_category_id_fkey TO posts_menu_id_fkey;
ALTER INDEX blog.posts_category_idx RENAME TO posts_menu_idx;

-- 페이지도 메뉴에 올라간다 (페이지 모음 · 페이지 하나). 메뉴는 비어야 지울 수 있다
ALTER TABLE blog.pages ADD COLUMN menu_id uuid REFERENCES blog.menus (id) ON DELETE RESTRICT;
CREATE INDEX pages_menu_idx ON blog.pages (menu_id) WHERE menu_id IS NOT NULL;

-- migrate:down
DROP INDEX blog.pages_menu_idx;
ALTER TABLE blog.pages DROP COLUMN menu_id;
ALTER INDEX blog.posts_menu_idx RENAME TO posts_category_idx;
ALTER TABLE blog.posts RENAME CONSTRAINT posts_menu_id_fkey TO posts_category_id_fkey;
ALTER TABLE blog.posts RENAME COLUMN menu_id TO category_id;
DROP INDEX blog.menus_order_idx;
UPDATE blog.posts SET category_id = NULL WHERE category_id IS NOT NULL;
DELETE FROM blog.menus;
ALTER TABLE blog.menus
  DROP CONSTRAINT menus_space_id_slug_key,
  DROP CONSTRAINT menus_slug_check,
  DROP CONSTRAINT menus_name_check,
  DROP COLUMN updated_at,
  DROP COLUMN created_at,
  DROP COLUMN rss,
  DROP COLUMN agent_id,
  DROP COLUMN policy,
  DROP COLUMN kind;
ALTER TABLE blog.menus
  ADD COLUMN parent_id uuid CONSTRAINT categories_parent_id_fkey REFERENCES blog.menus (id) ON DELETE RESTRICT,
  ADD COLUMN deleted_at timestamptz;
ALTER TABLE blog.menus ADD CONSTRAINT categories_space_id_parent_id_slug_key UNIQUE NULLS NOT DISTINCT (space_id, parent_id, slug);
CREATE INDEX categories_tree_idx ON blog.menus (space_id, parent_id, sort);
CREATE INDEX categories_parent_idx ON blog.menus (parent_id);
ALTER TABLE blog.menus RENAME CONSTRAINT menus_pkey TO categories_pkey;
ALTER TABLE blog.menus RENAME TO categories;
