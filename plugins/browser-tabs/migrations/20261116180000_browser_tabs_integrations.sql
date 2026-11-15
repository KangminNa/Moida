-- migrate:up
-- MCP 2단계 읽기 통합 (2026-11-16, docs/MCP.md 6장): 사이트에서 되풀이하는 읽기 일을 Playwright 코드로 굳힌 "사이트 도구".
-- 에이전트는 site_run으로 부르고, 서버 러너가 AI 없이 코드를 돌린다. 코어 표는 값으로만 가리킨다 (외래키 없음)

-- 사이트 도구 하나. 상태: building(굳히는 중) · review(시험을 통과해 켜기를 기다림) · on · broken(연속 실패) · off.
-- live_seq는 켜진 버전, draft_seq는 마지막으로 시험을 통과한 버전. 실행 집계(runs_ok …)와 build_task_id는
-- 판(version)을 올리지 않고 적는다: 러너가 적는 값이 관리자의 편집과 부딪히지 않게
CREATE TABLE browser_tabs.integrations (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES browser_tabs.sites(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{1,39}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  hint text NOT NULL DEFAULT '' CHECK (char_length(hint) <= 4000),
  agent_id uuid,
  status text NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'review', 'on', 'broken', 'off')),
  live_seq integer CHECK (live_seq > 0),
  draft_seq integer CHECK (draft_seq > 0),
  build_task_id uuid,
  fail_streak integer NOT NULL DEFAULT 0 CHECK (fail_streak >= 0),
  runs_ok integer NOT NULL DEFAULT 0 CHECK (runs_ok >= 0),
  runs_failed integer NOT NULL DEFAULT 0 CHECK (runs_failed >= 0),
  last_run_at timestamptz,
  last_error text CHECK (char_length(last_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT integrations_space_name UNIQUE (space_id, name),
  CONSTRAINT integrations_on_has_live CHECK (status <> 'on' OR live_seq IS NOT NULL),
  CONSTRAINT integrations_review_has_draft CHECK (status <> 'review' OR draft_seq IS NOT NULL)
);
CREATE INDEX integrations_site ON browser_tabs.integrations (site_id);

-- 버전 하나: 입출력 형식 · 코드 · 시험과 그 결과. 고치지 않는다 (고치기는 새 버전). 도구 · 사이트를 지우면 함께 지운다
-- (설정이라서: 커넥터와 같다). 그래서 지우기는 막지 않고 고치기만 막는다
CREATE TABLE browser_tabs.integration_revisions (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  integration_id uuid NOT NULL REFERENCES browser_tabs.integrations(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  input_schema jsonb NOT NULL CHECK (jsonb_typeof(input_schema) = 'object'),
  output_schema jsonb NOT NULL CHECK (jsonb_typeof(output_schema) = 'object'),
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 32000),
  tests jsonb NOT NULL CHECK (jsonb_typeof(tests) = 'array'),
  passed integer NOT NULL CHECK (passed >= 0),
  total integer NOT NULL CHECK (total >= passed),
  build_task_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_revisions_seq UNIQUE (integration_id, seq)
);

CREATE FUNCTION browser_tabs.forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '사이트 도구의 버전은 고치지 않아요 (새 버전을 더해요)';
END;
$$;
CREATE TRIGGER integration_revisions_no_update
  BEFORE UPDATE ON browser_tabs.integration_revisions
  FOR EACH ROW EXECUTE FUNCTION browser_tabs.forbid_update();

-- 실행 하나 (에이전트의 site_run). queued → running(러너가 꺼냄, 임대 90초) → done · failed. 30일 지나면 지운다.
-- request_id는 "<에이전트 id>:<에이전트가 준 값>": 같은 부름은 한 번만 쌓인다
CREATE TABLE browser_tabs.runs (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  integration_id uuid NOT NULL REFERENCES browser_tabs.integrations(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  agent_id uuid NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  output jsonb,
  error text CHECK (char_length(error) <= 500),
  error_kind text CHECK (error_kind IN ('login', 'timeout', 'shape', 'code', 'lost', 'off')),
  runner_id uuid,
  tries integer NOT NULL DEFAULT 0 CHECK (tries >= 0),
  ms integer CHECK (ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT runs_request UNIQUE (space_id, request_id),
  CONSTRAINT runs_done_has_output CHECK (status <> 'done' OR output IS NOT NULL),
  CONSTRAINT runs_failed_has_error CHECK (status <> 'failed' OR error IS NOT NULL)
);
CREATE INDEX runs_waiting ON browser_tabs.runs (space_id, id) WHERE status IN ('queued', 'running');
CREATE INDEX runs_integration ON browser_tabs.runs (integration_id, id);

-- migrate:down
DROP TABLE browser_tabs.runs;
DROP TABLE browser_tabs.integration_revisions;
DROP FUNCTION browser_tabs.forbid_update();
DROP TABLE browser_tabs.integrations;
