-- migrate:up
-- 제안의 까닭 (2026-11-21): 승인한 누르기 계획으로 실제로 누른 일에서 기록된 쓰기 API를 바로 쓰기 도구로 제안할 때 적는다.
-- 되풀이 제안은 비어 있다
ALTER TABLE browser_tabs.suggestions
  ADD COLUMN note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500);

-- migrate:down
ALTER TABLE browser_tabs.suggestions DROP COLUMN note;
