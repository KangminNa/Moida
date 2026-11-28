-- migrate:up
-- 확인 필요 판단 (L3, 기획서 결정 2026-11-17 "중간 판단 알림과 검증 루프").
-- 대화마다 멈춤 기준: all(판단마다 멈춤) · confirm(확인 필요 판단만, 기본) · end(끝에서만. 되돌리기 어려운 판단은 그래도 멈춤)
ALTER TABLE task.chats
  ADD COLUMN stop_mode text NOT NULL DEFAULT 'confirm'
    CONSTRAINT chats_stop_mode_check CHECK (stop_mode IN ('all', 'confirm', 'end'));

-- 승인의 기한: 지나면 서버가 정한 대로 한다 (판단은 추천안으로 이어서). 화면은 남은 시간을 보인다. 기한 없는 승인은 null
ALTER TABLE task.approvals ADD COLUMN expires_at timestamptz;
CREATE INDEX approvals_expiring_idx ON task.approvals (expires_at)
  WHERE status = 'pending' AND expires_at IS NOT NULL;

-- migrate:down
DROP INDEX task.approvals_expiring_idx;
ALTER TABLE task.approvals DROP COLUMN expires_at;
ALTER TABLE task.chats DROP COLUMN stop_mode;
