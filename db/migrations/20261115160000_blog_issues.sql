-- migrate:up
-- 2차 6단계 매거진 호 (서브나 9장): 아직 쓰지 않던 시리즈(blog.series)를 호로 바꿔 넓힌다. 쓰지 않던 표라 비어 있다.
-- 호는 "호 목록" 메뉴 안에 번호로 있고, 글은 issue_id · issue_order로 호에 들어간다 (글 목록 메뉴와 호 중 하나에만).
-- 발행은 결재 동작 하나(blog.issue.publish): 서버가 한 트랜잭션에서 호와 그 안의 글을 모두 공개한다.
ALTER TABLE blog.series RENAME TO issues;
ALTER TABLE blog.issues RENAME CONSTRAINT series_pkey TO issues_pkey;
ALTER TABLE blog.issues DROP CONSTRAINT series_space_id_slug_key;
ALTER TABLE blog.issues DROP COLUMN slug;
ALTER TABLE blog.issues RENAME COLUMN name TO title;
ALTER TABLE blog.issues RENAME COLUMN description TO intro;
ALTER TABLE blog.issues
  ADD COLUMN menu_id uuid NOT NULL REFERENCES blog.menus (id) ON DELETE RESTRICT,
  ADD COLUMN number int NOT NULL CHECK (number >= 1),
  ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  ADD COLUMN published_at timestamptz,
  ADD COLUMN version int NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT issues_title_check CHECK (char_length(title) BETWEEN 1 AND 120),
  ADD CONSTRAINT issues_intro_check CHECK (intro IS NULL OR char_length(intro) <= 2000),
  ADD CONSTRAINT issues_published_check CHECK ((status = 'published') = (published_at IS NOT NULL)),
  -- 한 메뉴 안의 호 번호는 하나 (호 목록 · 주소 /m/<메뉴>/<번호>)
  ADD CONSTRAINT issues_menu_id_number_key UNIQUE (menu_id, number);

ALTER TABLE blog.posts RENAME COLUMN series_id TO issue_id;
ALTER TABLE blog.posts RENAME COLUMN series_order TO issue_order;
ALTER TABLE blog.posts RENAME CONSTRAINT posts_series_id_fkey TO posts_issue_id_fkey;
ALTER INDEX blog.posts_series_idx RENAME TO posts_issue_idx;
ALTER TABLE blog.posts ADD CONSTRAINT posts_menu_or_issue CHECK (menu_id IS NULL OR issue_id IS NULL);

-- migrate:down
ALTER TABLE blog.posts DROP CONSTRAINT posts_menu_or_issue;
ALTER INDEX blog.posts_issue_idx RENAME TO posts_series_idx;
ALTER TABLE blog.posts RENAME CONSTRAINT posts_issue_id_fkey TO posts_series_id_fkey;
ALTER TABLE blog.posts RENAME COLUMN issue_order TO series_order;
ALTER TABLE blog.posts RENAME COLUMN issue_id TO series_id;
UPDATE blog.posts SET series_id = NULL, series_order = NULL WHERE series_id IS NOT NULL;
DELETE FROM blog.issues;
ALTER TABLE blog.issues
  DROP CONSTRAINT issues_menu_id_number_key,
  DROP CONSTRAINT issues_published_check,
  DROP CONSTRAINT issues_intro_check,
  DROP CONSTRAINT issues_title_check,
  DROP COLUMN updated_at,
  DROP COLUMN version,
  DROP COLUMN published_at,
  DROP COLUMN status,
  DROP COLUMN number,
  DROP COLUMN menu_id;
ALTER TABLE blog.issues RENAME COLUMN intro TO description;
ALTER TABLE blog.issues RENAME COLUMN title TO name;
ALTER TABLE blog.issues ADD COLUMN slug text NOT NULL;
ALTER TABLE blog.issues ADD CONSTRAINT series_space_id_slug_key UNIQUE (space_id, slug);
ALTER TABLE blog.issues RENAME CONSTRAINT issues_pkey TO series_pkey;
ALTER TABLE blog.issues RENAME TO series;
