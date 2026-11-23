-- migrate:up
-- 작업 기록의 휴지통 (2026-11-23, 사용자 요청 "작업이랑 보관함쪽에 전체삭제"): 끝난 작업(완료 · 실패 · 취소)을 작업 기록 목록에서 뺀다.
-- 줄은 지우지 않는다 (원칙 2: 실행 기록 · 결과물 · 판정 · 대화의 회차가 가리킨다). 목록에서만 빠지고 휴지통에서 꺼낼 수 있다.
-- 도는 작업은 휴지통에 넣지 않는다 (먼저 멈춘다)
ALTER TABLE task.tasks ADD COLUMN deleted_at timestamptz;
ALTER TABLE task.tasks ADD CONSTRAINT tasks_trash_finished
  CHECK (deleted_at IS NULL OR status IN ('done', 'failed', 'cancelled'));
CREATE INDEX tasks_trash_idx ON task.tasks (space_id, id DESC) WHERE deleted_at IS NOT NULL;

-- migrate:down
DROP INDEX task.tasks_trash_idx;
ALTER TABLE task.tasks DROP CONSTRAINT tasks_trash_finished;
ALTER TABLE task.tasks DROP COLUMN deleted_at;
