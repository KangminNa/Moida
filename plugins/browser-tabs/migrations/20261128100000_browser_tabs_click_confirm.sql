-- migrate:up
-- 승인 후 클릭 뒤 확인 단계 (L3, 기획서 결정 2026-11-17): 러너(AI 없음)가 누른 뒤 그 화면을 한 번 더 읽어
-- 결제 · 본인 인증 화면이면 auth(관리자가 대화 카드의 서버 브라우저 화면에서 마친다), 결과 화면이면 done과 예약 · 주문 번호를 남긴다.
-- 화면의 글은 남기지 않는다: 상태 · 번호(40자) · 페이지 제목(100자)만. 앞의 클릭은 비어 있다
ALTER TABLE browser_tabs.clicks
  ADD COLUMN confirm_state text CONSTRAINT clicks_confirm_state_check CHECK (confirm_state IN ('auth', 'done')),
  ADD COLUMN confirm_ref text CHECK (char_length(confirm_ref) <= 40),
  ADD COLUMN confirm_title text CHECK (char_length(confirm_title) <= 100);

-- migrate:down
ALTER TABLE browser_tabs.clicks
  DROP COLUMN confirm_title,
  DROP COLUMN confirm_ref,
  DROP COLUMN confirm_state;
