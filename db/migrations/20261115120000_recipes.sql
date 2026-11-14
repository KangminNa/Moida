-- migrate:up
-- 2차 5단계 자동화 레시피 (서브나 9장): 새 표 없이 스케줄을 넓힌다. "언제 · 누가 · 무엇을 · 받을 것 · 어디로" 한 장.

-- destination: 어디로. task(작업 하나, 7단계의 스케줄) · chat(맡은 에이전트의 대화 회차 하나: 결과 카드 · 검사를 그대로 쓴다)
--   · page(페이지의 새 버전, page_id)
-- deliver: 받을 것 (대화로 보낼 때만, chats.deliver와 같은 목록). 대화를 열 때 그 대화의 받을 것이 된다
-- rules: 지킬 것 (지시 뒤에 붙어 AI에게 간다)
-- trigger: 계기. time(정한 시각) · manual(손으로 "지금 실행"만) · after(after_id 레시피의 일이 끝나면)
-- chat_id: 이 레시피가 회차를 쌓는 대화 (처음 돌 때 연다. 담당 · 받을 것 · 어디로가 바뀌면 비워 새 대화를 연다)
ALTER TABLE task.schedules
  ADD COLUMN destination text NOT NULL DEFAULT 'task' CHECK (destination IN ('task', 'chat', 'page')),
  ADD COLUMN deliver text CHECK (deliver IN ('html', 'blog', 'browser', 'code')),
  ADD COLUMN rules text NOT NULL DEFAULT '' CHECK (char_length(rules) <= 2000),
  ADD COLUMN trigger text NOT NULL DEFAULT 'time' CHECK (trigger IN ('time', 'manual', 'after')),
  ADD COLUMN after_id uuid REFERENCES task.schedules (id) ON DELETE SET NULL,
  ADD COLUMN chat_id uuid REFERENCES task.chats (id) ON DELETE SET NULL;

UPDATE task.schedules SET destination = 'page' WHERE page_id IS NOT NULL;

ALTER TABLE task.schedules
  ADD CONSTRAINT schedules_page_destination CHECK ((destination = 'page') = (page_id IS NOT NULL)),
  ADD CONSTRAINT schedules_deliver_chat CHECK (deliver IS NULL OR destination = 'chat'),
  ADD CONSTRAINT schedules_after_trigger CHECK (after_id IS NULL OR (trigger = 'after' AND after_id <> id)),
  -- 정한 시각으로 도는 켜진 레시피만 다음 시각이 있다 (손 · 다른 레시피 뒤는 일꾼이 시각으로 깨우지 않는다)
  DROP CONSTRAINT schedules_next_check,
  ADD CONSTRAINT schedules_next_check CHECK ((enabled AND trigger = 'time') = (next_run_at IS NOT NULL));

-- 레시피의 일이 끝나면 그 뒤에 도는 레시피 찾기
CREATE INDEX schedules_after_idx ON task.schedules (after_id) WHERE after_id IS NOT NULL;

-- migrate:down
DROP INDEX task.schedules_after_idx;
UPDATE task.schedules SET enabled = false WHERE enabled AND next_run_at IS NULL;
ALTER TABLE task.schedules
  DROP CONSTRAINT schedules_next_check,
  ADD CONSTRAINT schedules_next_check CHECK (enabled = (next_run_at IS NOT NULL)),
  DROP CONSTRAINT schedules_after_trigger,
  DROP CONSTRAINT schedules_deliver_chat,
  DROP CONSTRAINT schedules_page_destination,
  DROP COLUMN chat_id,
  DROP COLUMN after_id,
  DROP COLUMN trigger,
  DROP COLUMN rules,
  DROP COLUMN deliver,
  DROP COLUMN destination;
