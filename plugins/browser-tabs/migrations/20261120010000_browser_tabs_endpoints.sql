-- migrate:up
-- 요청 기록 (B2, 2026-11-19 사용자 결정 "브라우저로 들어가도 분석하고 MCP로 변환"): 사이트 일 동안 러너(AI 없음)가 모은
-- 그 사이트의 XHR · fetch 요청의 모양. 값은 없다 (경로의 숫자 · id는 틀로, 쿼리 · 폼은 이름만, JSON은 칸 이름과 종류만).
-- 화면 대신 API를 부르는 사이트 도구를 만드는 AI의 재료다 (B3). 같은 모양(방법 · 출처 · 경로 틀)은 한 줄로 센다
CREATE TABLE browser_tabs.endpoints (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES browser_tabs.sites(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method ~ '^[A-Z]{3,7}$'),
  origin text NOT NULL CHECK (origin ~ '^https?://[a-z0-9.-]+(:\d{1,5})?$'),
  path text NOT NULL CHECK (path ~ '^/' AND char_length(path) <= 300),
  query text[] NOT NULL DEFAULT '{}',
  body jsonb,
  response jsonb,
  status integer NOT NULL DEFAULT 0 CHECK (status BETWEEN 0 AND 999),
  content_type text NOT NULL DEFAULT '' CHECK (char_length(content_type) <= 100),
  seen integer NOT NULL DEFAULT 1 CHECK (seen >= 1),
  last_task_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, method, origin, path)
);

-- API 사이트 도구를 저절로 만들기 시작한 때 (B3, 사이트마다 한 번: 기록이 쌓일 때마다 다시 만들지 않게)
ALTER TABLE browser_tabs.sites ADD COLUMN api_build_at timestamptz;

-- migrate:down
ALTER TABLE browser_tabs.sites DROP COLUMN api_build_at;
DROP TABLE browser_tabs.endpoints;
