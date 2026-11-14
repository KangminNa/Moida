-- migrate:up
-- 2차 7단계 모델 · 생각 강도 (서브나 10장 "모델 · 생각 강도는 어시스턴트 설정의 런타임 칸").
-- model: AI CLI에 넘기는 모델 이름. 빈 글이면 CLI의 기본 모델
-- effort: 생각 강도. 빈 글이면 CLI의 기본. 도구마다 받는 값이 달라 도구별 검사는 Agent(AgentRuntime)가 한다
-- 둘 다 설정 판(agent_revisions.settings)에 함께 남는다
ALTER TABLE task.agents
  ADD COLUMN model text NOT NULL DEFAULT '' CHECK (char_length(model) <= 80),
  ADD COLUMN effort text NOT NULL DEFAULT '' CHECK (effort IN ('', 'low', 'medium', 'high', 'xhigh', 'max'));

-- migrate:down
ALTER TABLE task.agents
  DROP COLUMN effort,
  DROP COLUMN model;
