-- migrate:up
-- 커뮤니티 앱 종류 (스토어 3-1, docs/스토어.md 11장, 2026-11-19). 앱 행은 blog에 두고, 회원 · 글 · 댓글은 community 스키마에 둔다.
-- 커뮤니티 앱에는 메뉴 · 블로그 글 · 페이지를 두지 않고, 지우지 않는다 (회원 · 글이 남아 있어서, 비공개로 둔다)
ALTER TABLE blog.apps DROP CONSTRAINT apps_kind_check;
ALTER TABLE blog.apps ADD CONSTRAINT apps_kind_check
  CHECK (kind IN ('blog', 'magazine', 'page', 'community'));

-- migrate:down
-- 커뮤니티 앱이 있으면 되돌리지 못한다 (CHECK가 막는다)
ALTER TABLE blog.apps DROP CONSTRAINT apps_kind_check;
ALTER TABLE blog.apps ADD CONSTRAINT apps_kind_check CHECK (kind IN ('blog', 'magazine', 'page'));
