-- migrate:up
-- 알림 종류마다 메일로도 보낼지 (2026-11-27, 사용자 "설정하지 않은 작업의 완료까지 이메일로 오고 있는데 이것도 기능으로 설정할 수 있어?").
-- mail: 종류 → on · off. 정하지 않은 종류는 그 종류의 기본 (대화의 답은 끔, 나머지는 켬).
--   메일은 경로가 push(푸시까지)인 알림에만 간다: 조용한 시간 · 묶음은 푸시와 같다
ALTER TABLE platform.notice_settings
  ADD COLUMN mail jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(mail) = 'object');

-- migrate:down
ALTER TABLE platform.notice_settings
  DROP COLUMN mail;
