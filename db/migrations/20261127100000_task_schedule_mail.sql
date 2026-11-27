-- migrate:up
-- 자동화 결과를 메일로 받기 (2026-11-27, 사용자 "대화에서 이메일로 보내달라는 스케줄은 설정 못하나?").
-- mail: 대화로 보내는 레시피의 회차가 끝나면 그 답(또는 실패)을 관리자 메일로도 보낸다.
--   받는 사람은 메일 플러그인의 "받을 주소"(관리자) 하나다. 다른 사람에게 보내는 길이 아니다 (전송은 원칙 7)
ALTER TABLE task.schedules
  ADD COLUMN mail boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT schedules_mail_chat CHECK (NOT mail OR destination = 'chat');

-- migrate:down
ALTER TABLE task.schedules
  DROP CONSTRAINT schedules_mail_chat,
  DROP COLUMN mail;
