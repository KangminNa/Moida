-- migrate:up
-- 누르기 전 내용 확인 (2026-11-24): AI가 멈춘 화면에서 확인할 값(받는 사람 · 금액 · 제목 같은 화면의 글자)을 적으면
-- 러너(AI 없음)가 붙잡을 때와 누르기 직전에 그 글자가 화면에 있는지 다시 본다. 없으면 붙잡지 않거나 누르지 않는다.
-- 승인 카드에 "확인한 내용"으로 보인다. 앞의 클릭은 비어 있다
ALTER TABLE browser_tabs.clicks
  ADD COLUMN checks text[] NOT NULL DEFAULT '{}' CHECK (cardinality(checks) <= 5);

-- migrate:down
ALTER TABLE browser_tabs.clicks DROP COLUMN checks;
