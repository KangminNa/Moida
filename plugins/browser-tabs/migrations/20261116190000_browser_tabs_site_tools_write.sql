-- migrate:up
-- MCP 3단계 (2026-11-16, docs/MCP.md 7장): 사이트 도구의 고장 자동 고치기 · 되풀이되는 일 알아채기 · 쓰기 도구 · 검토자 짝

-- 도구: 읽기 · 쓰기, 쓰기 도구의 검토자(값으로만), 마지막 자동 고치기 때(하루 한 번), 검토 중(reviewing) 상태
ALTER TABLE browser_tabs.integrations
  ADD COLUMN mode text NOT NULL DEFAULT 'read' CHECK (mode IN ('read', 'write')),
  ADD COLUMN reviewer_id uuid,
  ADD COLUMN repaired_at timestamptz,
  ADD CONSTRAINT integrations_write_has_reviewer CHECK (mode <> 'write' OR reviewer_id IS NOT NULL),
  DROP CONSTRAINT integrations_status_check,
  ADD CONSTRAINT integrations_status_check
    CHECK (status IN ('building', 'reviewing', 'review', 'on', 'broken', 'off'));

-- 검토 하나: 버전마다 한 번. 고치지 않는다 (도구를 지우면 함께)
CREATE TABLE browser_tabs.integration_reviews (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  integration_id uuid NOT NULL REFERENCES browser_tabs.integrations(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  reviewer_id uuid NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('pass', 'fix')),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_reviews_seq UNIQUE (integration_id, seq)
);
CREATE TRIGGER integration_reviews_no_update
  BEFORE UPDATE ON browser_tabs.integration_reviews
  FOR EACH ROW EXECUTE FUNCTION browser_tabs.forbid_update();

-- 실행: 쓰기 도구는 결재를 기다리고(held), 결재가 닫히면 dropped, 실행 중 러너가 멈추면 unknown(눌렸는지 모름, 다시 하지 않음)
ALTER TABLE browser_tabs.runs
  ADD COLUMN approval_id uuid,
  DROP CONSTRAINT runs_status_check,
  ADD CONSTRAINT runs_status_check
    CHECK (status IN ('held', 'queued', 'running', 'done', 'failed', 'dropped', 'unknown'));
DROP INDEX browser_tabs.runs_waiting;
CREATE INDEX runs_waiting ON browser_tabs.runs (space_id, id) WHERE status IN ('held', 'queued', 'running');

-- 되풀이 알아채기: 사이트 일 하나마다 지시의 열쇠(정규화한 지시의 sha256)를 남기고,
-- 같은 사이트 · 같은 열쇠가 14일 안에 3번이면 제안 하나 (사이트 · 열쇠마다 하나, 만들었거나 그만 보기면 다시 내지 않는다)
CREATE TABLE browser_tabs.browse_seen (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES browser_tabs.sites(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  key text NOT NULL CHECK (key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT browse_seen_task UNIQUE (task_id)
);
CREATE INDEX browse_seen_site_key ON browser_tabs.browse_seen (site_id, key, created_at);

CREATE TABLE browser_tabs.suggestions (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES browser_tabs.sites(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[0-9a-f]{64}$'),
  count integer NOT NULL CHECK (count > 0),
  sample text NOT NULL CHECK (char_length(sample) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'made')),
  integration_id uuid REFERENCES browser_tabs.integrations(id) ON DELETE SET NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT suggestions_site_key UNIQUE (site_id, key)
);

-- migrate:down
DROP TABLE browser_tabs.suggestions;
DROP TABLE browser_tabs.browse_seen;
DROP INDEX browser_tabs.runs_waiting;
CREATE INDEX runs_waiting ON browser_tabs.runs (space_id, id) WHERE status IN ('queued', 'running');
ALTER TABLE browser_tabs.runs
  DROP CONSTRAINT runs_status_check,
  ADD CONSTRAINT runs_status_check CHECK (status IN ('queued', 'running', 'done', 'failed')),
  DROP COLUMN approval_id;
DROP TABLE browser_tabs.integration_reviews;
ALTER TABLE browser_tabs.integrations
  DROP CONSTRAINT integrations_status_check,
  ADD CONSTRAINT integrations_status_check
    CHECK (status IN ('building', 'review', 'on', 'broken', 'off')),
  DROP CONSTRAINT integrations_write_has_reviewer,
  DROP COLUMN repaired_at,
  DROP COLUMN reviewer_id,
  DROP COLUMN mode;
