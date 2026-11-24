-- migrate:up
-- AI 신고 검토 (2026-11-24, 스토어 3-3): 일꾼이 제안한 결정을 관리자가 승인해 반영하면 by_kind approved, by_id는 승인한 관리자.
-- 관리자가 직접 누른 것(owner) · 신고가 쌓여 시스템이 가린 것(system)과 기록에서 가른다
ALTER TABLE community.decisions DROP CONSTRAINT decisions_by_kind_check;
ALTER TABLE community.decisions ADD CONSTRAINT decisions_by_kind_check
  CHECK (by_kind IN ('system', 'owner', 'approved'));

-- migrate:down
-- 기록은 지우지 못한다 (추가만): 이미 남은 approved 줄은 두고 새 줄만 막는다
ALTER TABLE community.decisions DROP CONSTRAINT decisions_by_kind_check;
ALTER TABLE community.decisions ADD CONSTRAINT decisions_by_kind_check
  CHECK (by_kind IN ('system', 'owner')) NOT VALID;
