-- migrate:up
-- MCP 먼저 1단계 (2026-11-15, docs/MCP.md): 커넥터(원격 MCP)의 연결 확인 · 도구 목록 · 사용 기록.
-- catalog: 러너가 tools/list로 받은 도구 [{ name, description }] (100개까지). 확인이 실패하면 앞 목록을 그대로 둔다.
-- checked_at · check_error: 마지막 확인과 실패 까닭 (성공이면 NULL). 서버는 원격에 붙지 않는다: 확인은 러너의 일(tool_check)이다.
-- last_used_at · last_failed_at · last_error: 에이전트의 일에서 이 커넥터의 도구를 부른 마지막 때와 실패.
-- 이 칸들은 러너의 보고로 자주 바뀌므로 version · updated_at을 올리지 않는다 (관리자의 고치기가 막히지 않게, runners.last_seen_at과 같다)
ALTER TABLE task.external_tools
  ADD COLUMN catalog jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(catalog) = 'array' AND jsonb_array_length(catalog) <= 100),
  ADD COLUMN checked_at timestamptz,
  ADD COLUMN check_error text CHECK (char_length(check_error) BETWEEN 1 AND 500),
  ADD COLUMN last_used_at timestamptz,
  ADD COLUMN last_failed_at timestamptz,
  ADD COLUMN last_error text CHECK (char_length(last_error) BETWEEN 1 AND 500),
  ADD CONSTRAINT external_tools_check_error_at CHECK (check_error IS NULL OR checked_at IS NOT NULL);

-- migrate:down
ALTER TABLE task.external_tools
  DROP CONSTRAINT external_tools_check_error_at,
  DROP COLUMN last_error,
  DROP COLUMN last_failed_at,
  DROP COLUMN last_used_at,
  DROP COLUMN check_error,
  DROP COLUMN checked_at,
  DROP COLUMN catalog;
