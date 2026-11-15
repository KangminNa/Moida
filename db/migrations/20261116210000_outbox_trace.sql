-- migrate:up
-- 리팩토링 R1 (2026-11-16, docs/리팩토링계획.md 8장): 실패 보이기 · 요청 번호를 일꾼까지.
-- trace_id: 이 이벤트를 남긴 요청의 번호 (X-Request-Id, UUIDv7). 일꾼이 처리할 때 같은 번호로 로그를 남기고,
--   처리하다 남긴 이벤트도 같은 번호를 잇는다. 요청 밖(반복 · 마감 작업)에서 남긴 것은 그 실행의 번호. 모르면 NULL.
-- 8번 실패해 멈춘 이벤트(failed_at)는 관리자가 화면 · 명령줄에서 보고 다시 시도한다: 공간별 최근부터 읽는 색인.
ALTER TABLE platform.outbox ADD COLUMN trace_id uuid;

CREATE INDEX outbox_failed_idx ON platform.outbox (space_id, failed_at DESC)
  WHERE failed_at IS NOT NULL;

-- migrate:down
DROP INDEX platform.outbox_failed_idx;
ALTER TABLE platform.outbox DROP COLUMN trace_id;
