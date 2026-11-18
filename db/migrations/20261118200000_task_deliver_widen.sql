-- migrate:up
-- 받을 것 넓히기 (O-3, docs/서브나.md 14장, 2026-11-18): 대표가 회차마다 받을 것을 정하고(set_deliver) 서버가 결과 카드에서 본다.
--   answer(짧은 답, 검사 없음) · file(결과물 하나 이상) · app_code(앱 코드 공개 승인) · setting(설정 바꾸기 · 자동화 승인)을 더한다.
--   회차의 받을 것은 맨 위 작업의 payload.chat.deliver (표를 더하지 않는다), 같은 목록 (ChatResult.deliverOf)
ALTER TABLE task.chats
  DROP CONSTRAINT chats_deliver_check,
  ADD CONSTRAINT chats_deliver_check
    CHECK (deliver IN ('answer', 'file', 'html', 'app_code', 'blog', 'browser', 'code', 'setting'));
ALTER TABLE task.schedules
  DROP CONSTRAINT schedules_deliver_check,
  ADD CONSTRAINT schedules_deliver_check
    CHECK (deliver IN ('answer', 'file', 'html', 'app_code', 'blog', 'browser', 'code', 'setting'));

-- migrate:down
-- 새 값을 쓴 줄은 받을 것을 비운다 (대화 답과 같다)
UPDATE task.chats SET deliver = NULL WHERE deliver IN ('answer', 'file', 'app_code', 'setting');
UPDATE task.schedules SET deliver = NULL WHERE deliver IN ('answer', 'file', 'app_code', 'setting');
ALTER TABLE task.chats
  DROP CONSTRAINT chats_deliver_check,
  ADD CONSTRAINT chats_deliver_check CHECK (deliver IN ('html', 'blog', 'browser', 'code'));
ALTER TABLE task.schedules
  DROP CONSTRAINT schedules_deliver_check,
  ADD CONSTRAINT schedules_deliver_check CHECK (deliver IN ('html', 'blog', 'browser', 'code'));
