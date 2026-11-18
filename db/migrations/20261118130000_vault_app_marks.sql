-- migrate:up
-- 스토어 1-2 (docs/스토어.md 8.5): 방문자 그래프의 글은 앱도 공개여야 보인다.
--   vault는 blog를 읽지 않고 이벤트로 사본을 둔다: 앱 공개 여부 사본(app_marks, blog.app.changed)과 글 자리 사본의 앱(post_marks.app_id, blog.post.*).
--   그래프의 방문자 읽기가 둘을 이어 SQL에서 거른다. 앱을 비공개로 바꾸면 app_marks 한 줄만 바뀐다.
--   app_id · 사본에 앱이 없는 글은 방문자 그래프에 나오지 않는다 (모르면 숨긴다).
CREATE TABLE vault.app_marks (
  app_id       uuid PRIMARY KEY,                    -- blog.apps.id (외래키 없음)
  space_id     uuid NOT NULL,
  public       boolean NOT NULL,                    -- 지운 앱은 false로 남긴다 (늦게 온 이벤트가 되살리지 못하게)
  app_version  int NOT NULL,                        -- blog 쪽 앱 version. 더 큰 것만 반영
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vault.post_marks ADD COLUMN app_id uuid;  -- blog.apps.id (외래키 없음)

-- 지금 값으로 한 번 채운다 (blog_apps 마이그레이션 바로 뒤라 이벤트가 없다). 원본은 blog이고, 다른 스키마를 읽는 것은 이 한 번뿐이다
INSERT INTO vault.app_marks (app_id, space_id, public, app_version)
SELECT id, space_id, visibility = 'public', version FROM blog.apps;
UPDATE vault.post_marks m SET app_id = p.app_id FROM blog.posts p WHERE p.id = m.post_id;

-- migrate:down
ALTER TABLE vault.post_marks DROP COLUMN app_id;
DROP TABLE vault.app_marks;
