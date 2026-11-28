-- migrate:up
-- 이름 cairn → moida (2026-11-28, 기획서 결정): 작업 브랜치는 moida/<작업>이다. 이름을 바꾸기 전에 연 PR(cairn/<작업>)과
-- 옛 러너가 올리는 브랜치도 받는다
ALTER TABLE code_github.pulls DROP CONSTRAINT pulls_branch_check;
ALTER TABLE code_github.pulls ADD CONSTRAINT pulls_branch_check
  CHECK (branch ~ '^(moida|cairn)/[0-9a-f-]{36}$');

-- migrate:down
ALTER TABLE code_github.pulls DROP CONSTRAINT pulls_branch_check;
ALTER TABLE code_github.pulls ADD CONSTRAINT pulls_branch_check
  CHECK (branch ~ '^cairn/[0-9a-f-]{36}$');
