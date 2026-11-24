-- migrate:up
-- 속도 (2026-11-24): 실행 기록 전체를 훑던 토큰 합계와 request_id 앞부분 찾기를 색인으로.
-- 토큰이 있는 실행 기록만 작업마다 (대화 · 목록 · 일꾼 · 성적표 · 스킬 성적의 합계, 쿼리는 tokens > 0을 함께 건다)
CREATE INDEX task_events_task_tokens ON task.task_events (task_id) INCLUDE (tokens, at) WHERE tokens > 0;
-- request_id 앞부분 (chat:<대화>: · lessons:<공간>:): DB의 정렬 규칙과 상관없이 LIKE 'x%'와 범위(~>=~ · ~<~)가 쓴다
CREATE INDEX tasks_request_prefix ON task.tasks (space_id, request_id text_pattern_ops);

-- migrate:down
DROP INDEX task.tasks_request_prefix;
DROP INDEX task.task_events_task_tokens;
