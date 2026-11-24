-- migrate:up
-- 대표에게 이름을 붙인다 (2026-11-24, 사용자 결정 "대표라고 했던 가상의 에이전트를 우리도 이름을 붙이고"):
-- 관리자는 이 이름으로 부르며 대표와 대화하고, 설정 › AI에서 바꾼다 (AgentLead.DEFAULT_NAME과 같은 값).
-- 서버가 정해 둔 이름 "대표"인 대표만 바꾸고(사람이 고친 것이 아니다), 바뀐 모습을 설정 판으로 쌓는다 (Agent.settingsSnapshot과 같은 칸)
UPDATE task.agents
SET name = '아리', settings_revision = settings_revision + 1, version = version + 1
WHERE lead AND name = '대표';

INSERT INTO task.agent_revisions (agent_id, revision, settings)
SELECT a.id, a.settings_revision, jsonb_build_object(
    'name', a.name, 'role', a.role, 'tool', a.tool, 'scopes', to_jsonb(a.scopes),
    'approval_actions', to_jsonb(a.approval_actions), 'monthly_limit', a.monthly_limit,
    'five_hour_limit', a.five_hour_limit, 'plan_stop_percent', a.plan_stop_percent,
    'model', a.model, 'effort', a.effort, 'external_tools', to_jsonb(a.external_tools),
    'runner_id', a.runner_id)
FROM task.agents a
WHERE a.lead AND a.name = '아리'
  AND NOT EXISTS (
    SELECT 1 FROM task.agent_revisions r WHERE r.agent_id = a.id AND r.revision = a.settings_revision);

-- migrate:down
-- 옛 이름은 설정 판에 남아 있다. 되돌리지 않는다 (판은 추가만)
SELECT 1;
