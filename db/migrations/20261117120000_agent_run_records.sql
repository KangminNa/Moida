-- migrate:up
-- 에이전트 실행의 기록 (기획서 결정 2026-11-17 "에이전트 실행의 기록은 작업 세션이다" · "CLI 세션은 세션 키마다 재개한다").
-- task: 실행 기록에 세션 키(lineage), CLI 세션 id, 재개했는지를 더한다. 세션 키는 빌려 줄 때 정하고,
-- CLI 세션 id · 재개 여부는 러너의 첫 보고가 비어 있을 때 한 번만 채운다 (model과 같은 길)
ALTER TABLE task.task_runs
  ADD COLUMN lineage     text CHECK (char_length(lineage) BETWEEN 1 AND 120),
  ADD COLUMN cli_session text CHECK (char_length(cli_session) BETWEEN 1 AND 120),
  ADD COLUMN resumed     boolean;
CREATE INDEX task_runs_lineage_idx ON task.task_runs (space_id, lineage, started_at DESC)
  WHERE lineage IS NOT NULL;

-- 실행 기록은 고치지 않는다. 비어 있는 model · cli_session · resumed를 한 번씩 채우는 것만 된다
CREATE OR REPLACE FUNCTION task.task_runs_model_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.model IS NOT NULL AND NEW.model IS DISTINCT FROM OLD.model)
    OR (OLD.cli_session IS NOT NULL AND NEW.cli_session IS DISTINCT FROM OLD.cli_session)
    OR (OLD.resumed IS NOT NULL AND NEW.resumed IS DISTINCT FROM OLD.resumed)
    OR (to_jsonb(NEW) - 'model' - 'cli_session' - 'resumed')
      IS DISTINCT FROM (to_jsonb(OLD) - 'model' - 'cli_session' - 'resumed') THEN
    RAISE EXCEPTION 'task.task_runs: 실행 기록은 비어 있는 model · cli_session · resumed를 한 번 채우는 것 말고는 바꿀 수 없어요';
  END IF;
  RETURN NEW;
END $$;

-- vault: 인수인계 메모 (CLI가 끝나기 전에 다음 실행에 넘기는 요약). 작업 세션의 원문 한 줄마다 하나, 추가만.
-- 같은 세션 키의 다음 실행이 최근 것을 받는다. task_id · agent_id는 task 모듈의 값이라 외래키가 없다
CREATE TABLE vault.run_memos (
  id             uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id       uuid NOT NULL,
  session_id     uuid NOT NULL REFERENCES vault.sessions(node_id) ON DELETE CASCADE,
  transcript_seq int NOT NULL CHECK (transcript_seq > 0),
  lineage        text NOT NULL CHECK (char_length(lineage) BETWEEN 1 AND 120),
  task_id        uuid NOT NULL,
  run_seq        int NOT NULL CHECK (run_seq > 0),
  agent_id       uuid,
  agent_name     text NOT NULL CHECK (char_length(agent_name) BETWEEN 1 AND 80),
  task_title     text NOT NULL CHECK (char_length(task_title) BETWEEN 1 AND 200),
  memo           text NOT NULL CHECK (char_length(memo) BETWEEN 1 AND 4000),
  written_by     text NOT NULL CHECK (written_by IN ('ai', 'runner')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, run_seq),
  UNIQUE (session_id, transcript_seq)
);
CREATE INDEX run_memos_lineage_idx ON vault.run_memos (space_id, lineage, created_at DESC);
CREATE TRIGGER run_memos_append_only
  BEFORE UPDATE OR DELETE ON vault.run_memos
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- 작업 세션(도구 cairn-agent)은 러너 기기와 상관없이 요청 하나에 하나다 (원문을 올리는 러너가 바뀌어도)
CREATE UNIQUE INDEX sessions_agent_flow ON vault.sessions (space_id, source_session_id)
  WHERE tool = 'cairn-agent';

-- migrate:down
DROP INDEX vault.sessions_agent_flow;
DROP TABLE vault.run_memos;
CREATE OR REPLACE FUNCTION task.task_runs_model_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.model IS NOT NULL OR (to_jsonb(NEW) - 'model') IS DISTINCT FROM (to_jsonb(OLD) - 'model') THEN
    RAISE EXCEPTION 'task.task_runs: 실행 기록은 비어 있는 model을 한 번 채우는 것 말고는 바꿀 수 없어요';
  END IF;
  RETURN NEW;
END $$;
DROP INDEX task.task_runs_lineage_idx;
ALTER TABLE task.task_runs DROP COLUMN resumed, DROP COLUMN cli_session, DROP COLUMN lineage;
