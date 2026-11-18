-- migrate:up
-- 스토어와 앱 1단계 (docs/스토어.md 8.1, 2026-11-18): 블로그 하나를 여러 앱으로.
--   앱 = 앱 종류(blog · magazine · page)로 만든 서비스 하나. 바깥 주소는 /<slug>. 비공개로 만들어지고 관리자가 공개로 바꾼다.
--   방문자에게 글 · 메뉴 · 호 · 페이지가 보이려면 앱도 공개여야 한다 (조건은 blog 모듈의 AppScope 한 곳).
--   메뉴는 앱 하나에 들고 주소는 앱 안에서 하나다. 글의 app_id NULL = 아직 앱에 없는 글 (공개 · 링크만으로 바꿀 수 없다),
--   페이지의 app_id NULL = 앱 밖의 페이지 (지금처럼 /pages/<이름>/).
CREATE TABLE blog.apps (
  id              uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id        uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('blog', 'magazine', 'page')),          -- 만들 때만 정한다
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 2 AND 30),
  description     text NOT NULL DEFAULT '' CHECK (char_length(description) <= 200),
  visibility      text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  sort            int NOT NULL DEFAULT 0 CHECK (sort BETWEEN 0 AND 1000),
  icon_blob_hash  text,                                                                -- platform.blobs의 값 (BlobStore.registerUse)
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apps_space_id_slug_key UNIQUE (space_id, slug)
);
-- 앱 목록 · 공개 앱 아이콘 목록의 순서
CREATE INDEX apps_order_idx ON blog.apps (space_id, sort, created_at);

ALTER TABLE blog.menus ADD COLUMN app_id uuid REFERENCES blog.apps (id) ON DELETE RESTRICT;
ALTER TABLE blog.posts ADD COLUMN app_id uuid REFERENCES blog.apps (id) ON DELETE RESTRICT;
ALTER TABLE blog.pages ADD COLUMN app_id uuid REFERENCES blog.apps (id) ON DELETE RESTRICT;

-- 지금 블로그를 기본 앱 하나로 (글 · 메뉴 · 메뉴에 올린 페이지가 있는 공간마다). 지금 블로그가 공개라 공개로 둔다
INSERT INTO blog.apps (space_id, kind, name, slug, visibility)
SELECT space_id, 'blog', '블로그', 'blog', 'public' FROM (
  SELECT space_id FROM blog.posts
  UNION SELECT space_id FROM blog.menus
  UNION SELECT space_id FROM blog.pages WHERE menu_id IS NOT NULL
) s;
UPDATE blog.menus m SET app_id = a.id FROM blog.apps a WHERE a.space_id = m.space_id;
UPDATE blog.posts p SET app_id = a.id FROM blog.apps a WHERE a.space_id = p.space_id;
UPDATE blog.pages g SET app_id = a.id FROM blog.apps a WHERE a.space_id = g.space_id AND g.menu_id IS NOT NULL;

-- 메뉴는 늘 앱 하나에. 주소는 공간 안에서 하나 → 앱 안에서 하나 (앱마다 "글" 메뉴를 둘 수 있게)
ALTER TABLE blog.menus ALTER COLUMN app_id SET NOT NULL;
ALTER TABLE blog.menus
  DROP CONSTRAINT menus_space_id_slug_key,
  ADD CONSTRAINT menus_app_id_slug_key UNIQUE (app_id, slug),
  ADD CONSTRAINT menus_id_app_id_key UNIQUE (id, app_id);
DROP INDEX blog.menus_order_idx;
CREATE INDEX menus_order_idx ON blog.menus (app_id, sort, created_at);

-- 글 · 페이지를 메뉴에 올렸으면 그 메뉴의 앱에 든다 (DB가 둘이 어긋나지 않게 지킨다)
ALTER TABLE blog.posts
  ADD CONSTRAINT posts_menu_in_app CHECK (menu_id IS NULL OR app_id IS NOT NULL),
  ADD CONSTRAINT posts_menu_app_fkey FOREIGN KEY (menu_id, app_id) REFERENCES blog.menus (id, app_id),
  ADD CONSTRAINT posts_shown_in_app CHECK (status = 'draft' OR app_id IS NOT NULL);
ALTER TABLE blog.pages
  ADD CONSTRAINT pages_menu_in_app CHECK (menu_id IS NULL OR app_id IS NOT NULL),
  ADD CONSTRAINT pages_menu_app_fkey FOREIGN KEY (menu_id, app_id) REFERENCES blog.menus (id, app_id);

-- 앱 첫 화면의 공개 글 목록, 앱에 든 페이지
CREATE INDEX posts_app_public_idx ON blog.posts (app_id, published_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX pages_app_idx ON blog.pages (app_id) WHERE app_id IS NOT NULL;

-- migrate:down
DROP INDEX blog.pages_app_idx;
DROP INDEX blog.posts_app_public_idx;
ALTER TABLE blog.pages
  DROP CONSTRAINT pages_menu_app_fkey,
  DROP CONSTRAINT pages_menu_in_app;
ALTER TABLE blog.posts
  DROP CONSTRAINT posts_shown_in_app,
  DROP CONSTRAINT posts_menu_app_fkey,
  DROP CONSTRAINT posts_menu_in_app;
DROP INDEX blog.menus_order_idx;
CREATE INDEX menus_order_idx ON blog.menus (space_id, sort, created_at);
ALTER TABLE blog.menus
  DROP CONSTRAINT menus_id_app_id_key,
  DROP CONSTRAINT menus_app_id_slug_key;
-- 앱이 여럿이었으면 메뉴 주소가 공간 안에서 겹칠 수 있다: 뒤의 것에 id 앞부분을 붙인다 (60자 안)
UPDATE blog.menus m SET slug = left(m.slug, 51) || '-' || left(m.id::text, 8)
WHERE EXISTS (
  SELECT 1 FROM blog.menus o WHERE o.space_id = m.space_id AND o.slug = m.slug AND o.id < m.id
);
ALTER TABLE blog.menus ADD CONSTRAINT menus_space_id_slug_key UNIQUE (space_id, slug);
ALTER TABLE blog.pages DROP COLUMN app_id;
ALTER TABLE blog.posts DROP COLUMN app_id;
ALTER TABLE blog.menus DROP COLUMN app_id;
DROP TABLE blog.apps;
