-- migrate:up
-- 소식 메일 수신 동의 (2026-11-27, 사용자 "가입자 전원인데 애초에 회원가입할 때 받아").
-- 가입 화면의 "소식 메일 받기 (선택)"에 체크한 때. 정보통신망법 제50조: 광고성 정보는 미리 받은 수신 동의가 있어야 보낸다.
-- 선택 동의라 비어 있어도 가입한다 (개인정보보호법 제22조). 받는 사람 목록은 메일 플러그인이 갖고, 이 칸은 동의한 때의 기록이다.
-- 탈퇴하면 지운다 (다른 개인정보와 같이)
ALTER TABLE community.accounts
  ADD COLUMN news_agreed_at timestamptz,
  ADD CONSTRAINT accounts_news_left CHECK (left_at IS NULL OR news_agreed_at IS NULL);

-- migrate:down
ALTER TABLE community.accounts
  DROP CONSTRAINT accounts_news_left,
  DROP COLUMN news_agreed_at;
