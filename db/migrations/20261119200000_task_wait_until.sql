-- migrate:up
-- 팀원 기다리기 (2026-11-19): 하위 작업을 기다리는 위 작업의 기한. 지나면 다 끝나지 않아도 위 작업을 깨워
-- 지금까지의 결과로 정하게 한다 (더 기다리기 · 더 맡기기 · 마무리). 하위 작업을 기다릴 때만 있다
ALTER TABLE task.tasks ADD COLUMN wait_until timestamptz;
ALTER TABLE task.tasks ADD CONSTRAINT tasks_wait_until_subtasks
  CHECK (wait_until IS NULL OR (status = 'waiting' AND wait_reason = 'subtasks'));
-- 마감 작업이 가장 이른 기한을 찾는다
CREATE INDEX tasks_wait_until_idx ON task.tasks (wait_until) WHERE wait_until IS NOT NULL;

-- migrate:down
DROP INDEX task.tasks_wait_until_idx;
ALTER TABLE task.tasks DROP CONSTRAINT tasks_wait_until_subtasks;
ALTER TABLE task.tasks DROP COLUMN wait_until;
