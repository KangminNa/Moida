-- migrate:up
-- 못 만듦 (C4 남은 일, docs/MCP.md 8장): 되풀이 제안으로 굳히기 시작한 도구가 실패 · 취소로 끝나면 제안을 failed로 두고
-- 까닭(작업의 실패 글 앞 300자)과 때를 남긴다. 30일 동안은 같은 일이 되풀이돼도 다시 굳히지 않고(그동안은 브라우저로 한다),
-- 30일이 지나 다시 되풀이되면 같은 도구를 다시 굳힌다. 콘솔의 "도구로 만들 만한 일"에 "못 만듦: 까닭"으로 보인다
ALTER TABLE browser_tabs.suggestions
  DROP CONSTRAINT suggestions_status_check,
  ADD CONSTRAINT suggestions_status_check CHECK (status IN ('open', 'dismissed', 'made', 'failed')),
  ADD COLUMN failed_at timestamptz,
  ADD COLUMN fail_reason text NOT NULL DEFAULT '' CHECK (char_length(fail_reason) <= 300);

-- migrate:down
UPDATE browser_tabs.suggestions SET status = 'made' WHERE status = 'failed';
ALTER TABLE browser_tabs.suggestions
  DROP COLUMN fail_reason,
  DROP COLUMN failed_at,
  DROP CONSTRAINT suggestions_status_check,
  ADD CONSTRAINT suggestions_status_check CHECK (status IN ('open', 'dismissed', 'made'));
