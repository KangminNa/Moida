-- migrate:up
-- 검수 (2026-11-20, 원칙 7 바꿈): 대표의 검토자 짝이 앱 안의 공개(글 · 호 · 앱 화면)를 결재 전에 검수하고,
-- 통과하면 관리자 대신 승인한다. 대표의 칸 하나로 켜고 끈다 (켜지 않으면 지금처럼 검토만 하고 관리자가 승인)
ALTER TABLE task.agents
  ADD COLUMN reviewer_approves boolean NOT NULL DEFAULT false;

-- 결재의 검수: 검수가 끝난 때(통과 · 고칠 것 · 넘김 모두), 에이전트(검수자)가 정한 결정인가
ALTER TABLE task.approvals
  ADD COLUMN inspected_at timestamptz,
  ADD COLUMN agent_decided boolean NOT NULL DEFAULT false;

-- migrate:down
ALTER TABLE task.approvals DROP COLUMN agent_decided, DROP COLUMN inspected_at;
ALTER TABLE task.agents DROP COLUMN reviewer_approves;
