-- migrate:up
-- 대화 입력창 (2026-11-15 B): 대화마다 모델 · 생각 강도, 맡기 전 첫 메시지의 참조.
-- model · effort: 비우면(NULL) 맡은 에이전트의 설정. 대화 상대의 회차에만 쓴다 (팀원은 각자의 설정). 강도는 그 도구가 받는 값만 (AgentRuntime)
-- pending_refs: 맡기 전(pending)에 받은 첫 메시지의 참조. 맡으면 첫 회차 작업의 payload.refs로 옮기고 비운다.
--   참조의 원본은 회차 작업의 payload.refs다 (표를 두지 않는다: 회차마다 고른 것이라 그 작업과 함께 남는다)
ALTER TABLE task.chats
  ADD COLUMN model text CHECK (char_length(model) BETWEEN 1 AND 80),
  ADD COLUMN effort text CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  ADD COLUMN pending_refs jsonb CHECK (pending_refs IS NULL OR jsonb_typeof(pending_refs) = 'array');

-- migrate:down
ALTER TABLE task.chats
  DROP COLUMN pending_refs,
  DROP COLUMN effort,
  DROP COLUMN model;
