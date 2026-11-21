-- migrate:up
-- 일 하나에 승인 한 번 (F2, 2026-11-21): 같은 사이트에서 마지막 버튼을 여러 번 눌러야 하는 일(목록에 12곳 저장 같은)은
-- AI가 첫 버튼 앞에서 계획(무엇을 · 몇 번)을 올리고, 관리자가 한 번 승인하면 같은 작업이 이어서 돈다.
-- 그 실행 안에서 AI가 버튼마다 누르기를 요청하면(requested) 러너(AI 없음)가 버튼을 다시 찾아 누른다.
-- 누르는 것은 여전히 믿는 코드다 (원칙 7). 횟수 · 사이트(허용 출처)는 서버가 지킨다

-- 누르기 계획 하나. 러너가 붙잡고(held) 결재를 올린다 → 승인(approved) → 작업이 끝나면 closed, 결재가 닫히면 dropped
CREATE TABLE browser_tabs.click_plans (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  task_id uuid NOT NULL,
  site_id uuid NOT NULL,
  page_url text NOT NULL CHECK (page_url ~ '^https?://' AND char_length(page_url) <= 2000),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 300),
  max_clicks integer NOT NULL CHECK (max_clicks BETWEEN 1 AND 50),
  -- 러너가 누르러 가져간 수 (요청만 하고 가져가지 않은 것은 세지 않는다)
  used integer NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND max_clicks),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'approved', 'closed', 'dropped')),
  approval_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
-- 작업 하나에 열린 계획은 하나뿐
CREATE UNIQUE INDEX click_plans_open_idx ON browser_tabs.click_plans (task_id)
  WHERE status IN ('held', 'approved');
CREATE INDEX click_plans_space_idx ON browser_tabs.click_plans (space_id, id DESC);

-- 계획 안의 누르기는 클릭 줄 하나씩이다 (콘솔의 클릭 목록 · 화면에 함께 보인다). AI가 요청한 때(requested)는
-- 러너 · 탭 · 지문이 아직 없고, 러너가 가져가면(clicking) 러너가, 버튼을 다시 찾으면 탭 · 자리 · 지문이 채워진다
ALTER TABLE browser_tabs.clicks
  ADD COLUMN plan_id uuid REFERENCES browser_tabs.click_plans (id) ON DELETE CASCADE,
  ALTER COLUMN runner_id DROP NOT NULL,
  ALTER COLUMN tab_id DROP NOT NULL,
  ALTER COLUMN box DROP NOT NULL,
  ALTER COLUMN fingerprint DROP NOT NULL,
  DROP CONSTRAINT clicks_status_check,
  ADD CONSTRAINT clicks_status_check CHECK (status IN
    ('requested', 'held', 'approved', 'clicking', 'clicked', 'changed', 'unknown', 'dropped', 'manual')),
  -- 계획 밖의 클릭은 붙잡을 때 모두 채운다. 계획 안은 가져갈 때 러너, 누르기 전에 나머지 (찾지 못하면 비어 있다)
  ADD CONSTRAINT clicks_held_fields CHECK (
    plan_id IS NOT NULL
    OR (runner_id IS NOT NULL AND tab_id IS NOT NULL AND box IS NOT NULL AND fingerprint IS NOT NULL)),
  ADD CONSTRAINT clicks_requested_in_plan CHECK (status <> 'requested' OR plan_id IS NOT NULL);
-- 작업 하나에 열린 클릭은 하나뿐 (요청한 누르기도 열린 것: 하나가 끝나야 다음을 요청한다)
DROP INDEX browser_tabs.clicks_open_idx;
CREATE UNIQUE INDEX clicks_open_idx ON browser_tabs.clicks (task_id)
  WHERE status IN ('requested', 'held', 'approved', 'clicking');
CREATE INDEX clicks_plan_idx ON browser_tabs.clicks (plan_id) WHERE plan_id IS NOT NULL;

-- migrate:down
DELETE FROM browser_tabs.clicks WHERE plan_id IS NOT NULL;
DROP INDEX browser_tabs.clicks_plan_idx;
DROP INDEX browser_tabs.clicks_open_idx;
CREATE UNIQUE INDEX clicks_open_idx ON browser_tabs.clicks (task_id)
  WHERE status IN ('held', 'approved', 'clicking');
ALTER TABLE browser_tabs.clicks
  DROP CONSTRAINT clicks_requested_in_plan,
  DROP CONSTRAINT clicks_held_fields,
  DROP CONSTRAINT clicks_status_check,
  ADD CONSTRAINT clicks_status_check CHECK (status IN
    ('held', 'approved', 'clicking', 'clicked', 'changed', 'unknown', 'dropped', 'manual')),
  ALTER COLUMN runner_id SET NOT NULL,
  ALTER COLUMN tab_id SET NOT NULL,
  ALTER COLUMN box SET NOT NULL,
  ALTER COLUMN fingerprint SET NOT NULL,
  DROP COLUMN plan_id;
DROP TABLE browser_tabs.click_plans;
