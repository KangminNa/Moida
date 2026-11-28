-- migrate:up
-- 이름 cairn → moida (2026-11-28, 기획서 결정): 작업 세션(에이전트 요청 하나의 기록)의 도구 이름 cairn-agent → moida-agent.
-- 세션 줄의 도구 칸만 바꾼다 (판 · 원문 · 인수인계 메모는 추가만 하는 표라 그대로). 요청 하나에 세션 하나인 색인도 새 이름으로
DROP INDEX vault.sessions_agent_flow;
UPDATE vault.sessions SET tool = 'moida-agent' WHERE tool = 'cairn-agent';
CREATE UNIQUE INDEX sessions_agent_flow ON vault.sessions (space_id, source_session_id)
  WHERE tool = 'moida-agent';

-- migrate:down
DROP INDEX vault.sessions_agent_flow;
UPDATE vault.sessions SET tool = 'cairn-agent' WHERE tool = 'moida-agent';
CREATE UNIQUE INDEX sessions_agent_flow ON vault.sessions (space_id, source_session_id)
  WHERE tool = 'cairn-agent';
