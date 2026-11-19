-- migrate:up
-- 대화 휴지통 (2026-11-19 휴지통 A): 관리자가 대화를 휴지통으로 보낸 때. 목록 · 상태판 · 소식에서 빠지고
-- 회차 작업 · 결과물 · 실행 기록은 그대로 남는다. 지우지 않는다 (원칙 2). 되살리면 비운다
ALTER TABLE task.chats ADD COLUMN deleted_at timestamptz;

-- migrate:down
ALTER TABLE task.chats DROP COLUMN deleted_at;
