-- migrate:up
-- 평가가 남는 팀 (2026-11-20, ECC에서 가져옴): 검토 · 검수의 판정을 점수와 함께 쌓는다 (추가만).
-- 판정받은 에이전트마다 한 줄: 검수는 결재를 올린 에이전트, 검토는 그 회차에 일한 바로 아래 팀장들 (없으면 대표).
-- 성적표(첫 판정 통과율 · 평균 고친 횟수)와 주간 팀 점검이 읽고, 검수는 앞 판정보다 점수가 오르지 않으면 관리자에게 넘긴다
CREATE TABLE task.verdicts (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id    uuid NOT NULL,
  task_id     uuid NOT NULL REFERENCES task.tasks(id),    -- 판정한 작업 (검토 · 검수)
  agent_id    uuid NOT NULL REFERENCES task.agents(id),   -- 판정받은 에이전트
  kind        text NOT NULL CHECK (kind IN ('review', 'inspect')),
  target      text NOT NULL CHECK (char_length(target) BETWEEN 1 AND 200),  -- 같은 대상의 판정을 잇는 열쇠
  round       int NOT NULL CHECK (round >= 1),            -- 같은 대상의 몇 번째 판정
  verdict     text NOT NULL CHECK (verdict IN ('pass', 'fix', 'reject', 'unknown')),
  score       real CHECK (score BETWEEN 1 AND 5),         -- 완료 조건 점수의 평균 (점수가 없으면 null)
  low         int CHECK (low BETWEEN 1 AND 5),            -- 가장 낮은 점수
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verdicts_once UNIQUE (task_id, agent_id)
);
CREATE INDEX verdicts_agent_idx ON task.verdicts (space_id, agent_id, created_at);    -- 성적표: 에이전트마다 최근 기간
CREATE INDEX verdicts_target_idx ON task.verdicts (space_id, target, created_at);    -- 검수: 같은 대상의 앞 판정
CREATE TRIGGER verdicts_append_only
  BEFORE UPDATE OR DELETE ON task.verdicts
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- 두 검수자 (선택, 기본 없음): 대표의 검수를 다른 AI 도구의 두 번째 검수자도 따로 보고, 둘 다 통과해야 공개한다
ALTER TABLE task.agents
  ADD COLUMN second_inspector_id uuid REFERENCES task.agents(id);

-- migrate:down
ALTER TABLE task.agents DROP COLUMN second_inspector_id;
DROP TABLE task.verdicts;
