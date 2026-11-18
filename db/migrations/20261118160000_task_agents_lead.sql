-- migrate:up
-- 대표 (O-2, docs/서브나.md 14장, 2026-11-18): 공간마다 숨은 에이전트 하나가 모든 대화 · 자동화 실행 · ask_agent를 받는다.
--   대표는 늘 맨 위(reports_to 없음)이고, 지금 맨 위 에이전트(팀장)들은 그대로 둔다: 대표는 그 위에서 누구에게나 맡긴다.
--   대표는 비공개를 읽지 않고 쓰지 않는다 (read_public만): 대표가 쓴 지시가 브라우저 팀으로 가도 비공개가 실리지 않게.
ALTER TABLE task.agents
  ADD COLUMN lead boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT agents_lead_top CHECK (NOT lead OR reports_to IS NULL);
CREATE UNIQUE INDEX agents_one_lead ON task.agents (space_id) WHERE lead AND deleted_at IS NULL;   -- 공간마다 하나

-- 에이전트가 있는 공간마다 대표 하나 (없는 공간은 첫 대화에서 서버가 만든다: AgentEdit.lead).
-- 도구는 서버에 로그인이 있는 것 (claude 먼저, 엔진 목록 순서), 없으면 claude. 관리자가 설정 › AI에서 바꾼다
INSERT INTO task.agents (space_id, name, role, tool, scopes, lead)
SELECT s.space_id, '대표', '대화를 받아 팀에 나눠 맡기고 결과를 모은다',
  coalesce((SELECT g.tool FROM task.ai_logins g WHERE g.space_id = s.space_id
            ORDER BY g.tool = 'claude' DESC, g.tool LIMIT 1), 'claude'),
  ARRAY['read_public']::text[], true
FROM (SELECT DISTINCT space_id FROM task.agents) s
WHERE NOT EXISTS (SELECT 1 FROM task.agents l WHERE l.space_id = s.space_id AND l.lead AND l.deleted_at IS NULL);
-- 새 대표의 설정 판 1 (에이전트를 만들 때와 같은 칸)
INSERT INTO task.agent_revisions (agent_id, revision, settings)
SELECT id, 1, jsonb_build_object(
    'name', name, 'role', role, 'tool', tool, 'scopes', to_jsonb(scopes),
    'approval_actions', to_jsonb(approval_actions), 'monthly_limit', monthly_limit,
    'five_hour_limit', five_hour_limit, 'plan_stop_percent', plan_stop_percent, 'reports_to', reports_to,
    'runner_id', runner_id, 'model', model, 'effort', effort, 'external_tools', to_jsonb(external_tools))
FROM task.agents
WHERE lead AND NOT EXISTS (SELECT 1 FROM task.agent_revisions r WHERE r.agent_id = task.agents.id);

-- 맡은 대화의 상대는 대표 (지나간 회차의 작업은 맡았던 에이전트 그대로).
-- 맡기 전 대화(agent_id 없음 · pending, chats_pending)는 그대로 두고 다음 말에 대표가 맡는다 (ChatService)
UPDATE task.chats c SET agent_id = l.id
FROM task.agents l
WHERE l.space_id = c.space_id AND l.lead AND l.deleted_at IS NULL
  AND c.agent_id IS NOT NULL AND c.agent_id <> l.id;
-- 배정 일은 없어진다: 기다리던 배정 일은 취소 (맡기 전 대화는 다음 말에 대표가 맡는다)
UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
WHERE kind = 'chat_route' AND status IN ('queued', 'running', 'waiting');
-- 결과를 대화로 보내는 스케줄은 대표가 맡는다 (담당 칸은 비운다)
UPDATE task.schedules SET agent_id = NULL WHERE destination = 'chat' AND agent_id IS NOT NULL;

-- migrate:down
-- 칸과 규칙만 되돌린다. 대표 줄은 설정 판(추가만)이 가리켜 지울 수 없어 보통 에이전트로 남는다
DROP INDEX task.agents_one_lead;
ALTER TABLE task.agents
  DROP CONSTRAINT agents_lead_top,
  DROP COLUMN lead;
