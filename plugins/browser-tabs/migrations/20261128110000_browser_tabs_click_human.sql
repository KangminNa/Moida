-- migrate:up
-- 멈춤 넓히기 (개인정보 규칙 ①, 기획서 결정 2026-11-17): 결제 수단 · 본인 인증 번호 · 주민번호 칸은 AI가 채우지 않는다.
-- AI는 마지막 버튼 앞에서 멈추며 그 칸의 이름(화면에 보이는 그대로, 40자 · 5개)만 적고, 관리자가 승인 카드의
-- 서버 브라우저 화면에서 직접 넣은 뒤 승인하면 러너(AI 없음)가 누른다. AI는 그 페이지로 돌아가지 않는다. 앞의 클릭은 비어 있다
ALTER TABLE browser_tabs.clicks
  ADD COLUMN human_fields text[] NOT NULL DEFAULT '{}' CHECK (cardinality(human_fields) <= 5);

-- migrate:down
ALTER TABLE browser_tabs.clicks DROP COLUMN human_fields;
