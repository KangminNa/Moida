-- migrate:up
-- C3 도구 바뀜 감지 (2026-11-25, docs/MCP.md 8장): 연결 확인에서 받은 도구 목록이 승인한 목록과 다르면
-- (새 도구 · 설명이 바뀐 도구) 새 목록을 여기에 두고 관리자가 승인할 때까지 그 커넥터를 일에 붙이지 않는다.
-- 연결 뒤 도구 설명을 바꿔 AI에게 다른 일을 시키는 공격을 막는다. 승인하면 catalog로 옮기고 비운다.
-- catalog · checked_at처럼 버전 없이 적는다 (관리자의 고치기와 겨루지 않게)
ALTER TABLE task.external_tools
  ADD COLUMN catalog_pending jsonb
    CHECK (catalog_pending IS NULL OR (jsonb_typeof(catalog_pending) = 'array' AND jsonb_array_length(catalog_pending) <= 100)),
  ADD COLUMN catalog_changed_at timestamptz;

-- migrate:down
ALTER TABLE task.external_tools
  DROP COLUMN catalog_pending,
  DROP COLUMN catalog_changed_at;
