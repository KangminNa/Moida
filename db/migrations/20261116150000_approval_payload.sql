-- migrate:up
-- 설정 바꾸기 제안 (2026-11-15 C): 승인할 바뀐 값을 결재에 싣는다.
-- AI가 propose_setting으로 올린 결재(task.setting.change)만 채운다: 서버가 미리 적용해 보고 적은 { setting, op, body, changes }.
-- 승인 뒤에는 바뀌지 않는다(결재는 상태만 바뀐다). 승인 이벤트(task.approval.granted)에 함께 실려 그 설정을 가진 쪽이 적용한다.
-- 다른 결재는 NULL: 대상(target_kind · target_id · target_version)이 그 자체로 승인할 것이다
ALTER TABLE task.approvals
  ADD COLUMN payload jsonb CHECK (payload IS NULL OR jsonb_typeof(payload) = 'object');

-- migrate:down
ALTER TABLE task.approvals DROP COLUMN payload;
