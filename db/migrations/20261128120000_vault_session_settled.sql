-- migrate:up
-- 끝난 요청의 작업 세션만 wiki 정리에 (S2, 기획서 결정 2026-11-17): 작업 세션(도구 cairn-agent)은 그 요청이 끝났다고
-- task가 알릴 때(완료 · 결과 카드 승인) 그때의 판 번호를 여기 적고, 정리는 이 판까지만 요청한다.
-- 취소 · 실패 · 반려된 요청은 적지 않고 정리 요청 번호(tidy_requested_seq)만 넘겨 원문으로만 둔다.
-- 사람의 AI 도구 세션은 쓰지 않는다 (늘 지금 판까지). 이미 있는 작업 세션은 0: 다음에 끝나는 요청부터 정리된다
ALTER TABLE vault.sessions
  ADD COLUMN settled_seq int NOT NULL DEFAULT 0 CHECK (settled_seq >= 0);

-- migrate:down
ALTER TABLE vault.sessions DROP COLUMN settled_seq;
