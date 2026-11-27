-- migrate:up
-- 메일 사용량 (2026-11-27, 사용자 "메일 사용량도 우리 무료 사용량에 맞춰서 모니터링 및 제한할 수 있도록").
-- 이 플러그인이 메일 회사의 SMTP로 내보내는 모든 메일을 날(UTC)과 종류마다 센다. 보내기 전에 한도를 보고 센다(take):
-- 서버(확인 메일)와 일꾼(알림 · 소식)이 함께 쓰므로 프로세스 메모리가 아니라 여기에 둔다.
--   sent: 한도 안이라 내보낸 수 (메일 회사가 거절한 것도 센다: 회사도 시도를 센다)
--   blocked: 한도에 닿아 보내지 않은 수 (화면에서 빠진 메일을 알게)
-- 받는 주소 · 제목은 적지 않는다 (수만 남긴다)
CREATE TABLE email.usage (
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('code', 'notice', 'answer', 'test', 'confirm', 'post', 'news')),
  sent integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  blocked integer NOT NULL DEFAULT 0 CHECK (blocked >= 0),
  PRIMARY KEY (day, kind)
);

-- migrate:down
DROP TABLE email.usage;
