-- migrate:up
-- 대표 ↔ 일꾼 대화 (2026-11-24, 사용자 요청 "대표가 하위 에이전트들과 소통하면서 일을 시킬 수 있도록"):
-- 일꾼이 MCP ask_lead로 대표에게 물으면 그 일은 답을 기다린다 (wait_reason lead). 대표가 reply_worker로 답하면 대기열로 돌아가
-- 답을 받아 이어서 한다. 결재(approval) · 하위 작업(subtasks)처럼 기다리는 까닭 하나를 더한다
ALTER TABLE task.tasks DROP CONSTRAINT tasks_wait_reason_check;
ALTER TABLE task.tasks ADD CONSTRAINT tasks_wait_reason_check
  CHECK (wait_reason IN ('approval', 'subtasks', 'lead'));

-- migrate:down
UPDATE task.tasks SET status = 'cancelled', wait_reason = NULL, finished_at = now()
WHERE status = 'waiting' AND wait_reason = 'lead';
ALTER TABLE task.tasks DROP CONSTRAINT tasks_wait_reason_check;
ALTER TABLE task.tasks ADD CONSTRAINT tasks_wait_reason_check
  CHECK (wait_reason IN ('approval', 'subtasks'));
