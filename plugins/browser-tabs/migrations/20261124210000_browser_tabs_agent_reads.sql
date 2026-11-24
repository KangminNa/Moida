-- migrate:up
-- 일꾼의 화면 읽기 (2026-11-24, MCP browser_read): 탭 읽기를 일꾼도 쓴다. 자바스크립트로 그리는 페이지 · 여러 페이지를
-- 러너(AI 없음)가 브라우저 탭으로 열어 그려진 글자를 읽는다. 일꾼의 읽기는 로그인 없는 새 빈 컨텍스트에서 내부 주소를 막고 연다.
-- agent_id: 읽어 달라고 한 에이전트 (비면 관리자가 콘솔에서). 있으면 러너가 빈 컨텍스트로 읽는다
-- request_id: 같은 요청은 한 번 (에이전트 id : 요청 id : 순번)
ALTER TABLE browser_tabs.reads ADD COLUMN agent_id uuid;
ALTER TABLE browser_tabs.reads ADD COLUMN request_id text CHECK (char_length(request_id) <= 300);
CREATE UNIQUE INDEX reads_request_key ON browser_tabs.reads (space_id, request_id) WHERE request_id IS NOT NULL;

-- migrate:down
DROP INDEX browser_tabs.reads_request_key;
ALTER TABLE browser_tabs.reads DROP COLUMN request_id;
ALTER TABLE browser_tabs.reads DROP COLUMN agent_id;
