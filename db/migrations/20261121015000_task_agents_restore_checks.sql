-- migrate:up
-- 되돌리기 길만 고친다 (2026-11-21, CI의 "전부 되돌리기"가 멈춤). 바로 다음 20261121020000_task_flat_agents가 권한 조합 CHECK 다섯을
-- 지우는데 그 down이 되살리지 않아, 더 옛 마이그레이션의 down(그 이름의 CHECK를 지우는)이 "없는 제약"으로 멈췄다.
-- 커밋된 마이그레이션은 고치지 않으므로 그 앞 자리에 이 파일을 둔다: 되돌릴 때 task_flat_agents의 down 다음에 이 down이 돌아,
-- 이 자리의 모양(옛 CHECK가 있던 때)으로 되살린다. 이미 모든 권한을 가진 에이전트가 있을 수 있어 NOT VALID로 건다.
-- up은 하는 일이 없다 (적용할 때는 옛 CHECK가 아직 있고, 다음 마이그레이션이 지운다)
SELECT 1;

-- migrate:down
ALTER TABLE task.agents
  DROP CONSTRAINT IF EXISTS agents_browse_not_private,
  DROP CONSTRAINT IF EXISTS agents_code_not_private,
  DROP CONSTRAINT IF EXISTS agents_make_not_private,
  DROP CONSTRAINT IF EXISTS agents_pinned_not_sandboxed,
  DROP CONSTRAINT IF EXISTS agents_tools_not_private;
ALTER TABLE task.agents
  ADD CONSTRAINT agents_browse_not_private
    CHECK (NOT ('browse' = ANY (scopes) AND scopes && ARRAY['read_all', 'write']::text[])) NOT VALID,
  ADD CONSTRAINT agents_code_not_private
    CHECK (NOT ('code' = ANY (scopes) AND scopes && ARRAY['read_all', 'write']::text[])) NOT VALID,
  ADD CONSTRAINT agents_make_not_private
    CHECK (NOT ('make' = ANY (scopes) AND scopes && ARRAY['read_all', 'write']::text[])) NOT VALID,
  ADD CONSTRAINT agents_pinned_not_sandboxed
    CHECK (runner_id IS NULL OR NOT (scopes && ARRAY['code', 'make']::text[])) NOT VALID,
  ADD CONSTRAINT agents_tools_not_private
    CHECK (cardinality(external_tools) = 0 OR NOT (scopes && ARRAY['read_all', 'write', 'code', 'make']::text[])) NOT VALID;
