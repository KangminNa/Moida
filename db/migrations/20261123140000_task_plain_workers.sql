-- migrate:up
-- 역할 이름 일꾼 정리 (2026-11-23, 사용자 결정 "역할 이름으로 만들어 둔 일꾼 정리"):
-- 2026-11-21에 권한 · 보고 라인은 모두 같게 했지만 팀 템플릿이 만든 일꾼의 이름 · 역할 설명(문서 제작자 · 조사 담당 …)은 남아,
-- 역할 설명이 지시문 맨 앞에 실려 일꾼마다 성향이 갈리고 대표도 이름을 보고 성격별로 나눠 맡겼다.
-- 대표가 아닌 지우지 않은 일꾼의 역할 설명을 비우고 이름을 공간마다 만든 순서로 "일꾼 N"으로 바꾼다.
-- 일꾼 줄 · 실행 기록 · 스케줄 · 성적표는 그대로 이어진다. 옛 이름 · 역할은 설정 판(agent_revisions, 추가만)에 남고,
-- 바뀐 모습을 새 판으로 쌓는다 (Agent.settingsSnapshot과 같은 칸). 휴지통의 일꾼은 건드리지 않는다.
CREATE TEMP TABLE plain_workers ON COMMIT DROP AS
SELECT id, '일꾼 ' || row_number() OVER (PARTITION BY space_id ORDER BY created_at, id) AS name
FROM task.agents
WHERE NOT lead AND deleted_at IS NULL;

DELETE FROM plain_workers p USING task.agents a
WHERE a.id = p.id AND a.name = p.name AND a.role = '';

UPDATE task.agents a
SET name = p.name, role = '', settings_revision = a.settings_revision + 1, version = a.version + 1
FROM plain_workers p
WHERE a.id = p.id;

INSERT INTO task.agent_revisions (agent_id, revision, settings)
SELECT a.id, a.settings_revision, jsonb_build_object(
    'name', a.name, 'role', a.role, 'tool', a.tool, 'scopes', to_jsonb(a.scopes),
    'approval_actions', to_jsonb(a.approval_actions), 'monthly_limit', a.monthly_limit,
    'five_hour_limit', a.five_hour_limit, 'plan_stop_percent', a.plan_stop_percent,
    'model', a.model, 'effort', a.effort, 'external_tools', to_jsonb(a.external_tools),
    'runner_id', a.runner_id)
FROM task.agents a JOIN plain_workers p ON p.id = a.id;

-- migrate:down
-- 옛 이름 · 역할은 설정 판에 남아 있다. 되돌리지 않는다 (판은 추가만이고, 되돌리려면 콘솔에서 그 판의 값으로 고친다)
SELECT 1;
