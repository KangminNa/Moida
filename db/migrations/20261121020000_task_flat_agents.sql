-- migrate:up
-- 팀 없는 에이전트 (2026-11-21, 사용자 결정 "팀을 나눠 놔서 복잡하다 · 비공개도 그냥 읽어"):
-- 대표 하나와 모두 같은 일꾼. 보고 라인(reports_to)이 없고, 대표가 누구에게나 맡긴다.
-- 모든 에이전트는 같은 권한(전부)을 갖는다: 비공개 읽기 · 초안 · 브라우저 · 코드 · 만들기 · 커넥터를 한 에이전트가 함께 쓴다.
-- 그래서 권한끼리 섞지 못하게 막던 CHECK와 러너 묶기와 칸 권한의 CHECK를 지운다 (칸의 일은 빌릴 때 칸 러너로 간다, TaskRepository.lockNext).
-- 바깥으로 나가는 동작(발행 · 전송 · 사이트에서 바꾸는 클릭)은 원칙 7대로 승인 뒤이고, 비밀값은 AI를 거치지 않는다 (원칙 8).
-- 설정 판(agent_revisions)은 추가만이라 옛 판의 reports_to · scopes는 그대로 남는다.
ALTER TABLE task.agents
  DROP CONSTRAINT agents_lead_top,
  DROP CONSTRAINT agents_reports_to_self,
  DROP CONSTRAINT agents_browse_not_private,
  DROP CONSTRAINT agents_code_not_private,
  DROP CONSTRAINT agents_make_not_private,
  DROP CONSTRAINT agents_tools_not_private,
  DROP CONSTRAINT agents_pinned_not_sandboxed;
DROP INDEX task.agents_reports_to_idx;
ALTER TABLE task.agents DROP COLUMN reports_to;
-- 모든 일꾼이 브라우저를 쓰므로 사이트 클릭 · 로그인 승인을 올릴 수 있게 한다 (승인은 여전히 관리자가 한다)
UPDATE task.agents
SET scopes = ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'browse', 'code', 'make']::text[],
  approval_actions = ARRAY(
    SELECT DISTINCT a FROM unnest(approval_actions || ARRAY['browser.site.publish', 'browser.site.login']::text[]) AS a
    ORDER BY a
  );

-- migrate:down
-- 권한 조합 CHECK는 되살리지 않는다: 이미 모든 권한을 가진 에이전트가 있어 맞지 않는다 (되돌리면 화면에서 권한을 다시 고른다)
ALTER TABLE task.agents ADD COLUMN reports_to uuid REFERENCES task.agents(id);
CREATE INDEX agents_reports_to_idx ON task.agents (reports_to);
ALTER TABLE task.agents
  ADD CONSTRAINT agents_reports_to_self CHECK (reports_to <> id),
  ADD CONSTRAINT agents_lead_top CHECK (NOT lead OR reports_to IS NULL);
