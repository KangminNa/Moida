-- migrate:up
-- 앱마다 도메인 (스토어 3-0, docs/스토어.md 11장, 2026-11-19)
-- domain: 이 앱의 바깥 도메인 (소문자 · 점으로 나눈 이름 · 국제 도메인은 xn-- 꼴, 모든 공간에서 하나). 없으면 기본 도메인의 /<slug>만
-- domain_checked_at: 관리자의 브라우저가 그 도메인의 /.well-known/cairn-domain을 읽어 이 서버로 이어진 것을 확인한 때.
--   도메인을 바꾸면 비운다. 확인한 도메인이어야 기본 도메인의 앱 주소가 그 도메인으로 보낸다
-- apps_domain_key: 도메인은 모든 공간에서 하나이고, 요청의 Host로 앱을 찾을 때(blog AppQuery.domains) 이 인덱스를 쓴다
ALTER TABLE blog.apps
  ADD COLUMN domain text,
  ADD COLUMN domain_checked_at timestamptz,
  ADD CONSTRAINT apps_domain_format CHECK (
    domain IS NULL OR (
      char_length(domain) BETWEEN 4 AND 253
      AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'
    )
  ),
  ADD CONSTRAINT apps_domain_checked CHECK (domain IS NOT NULL OR domain_checked_at IS NULL),
  ADD CONSTRAINT apps_domain_key UNIQUE (domain);

-- migrate:down
ALTER TABLE blog.apps
  DROP CONSTRAINT apps_domain_key,
  DROP CONSTRAINT apps_domain_checked,
  DROP CONSTRAINT apps_domain_format,
  DROP COLUMN domain_checked_at,
  DROP COLUMN domain;
