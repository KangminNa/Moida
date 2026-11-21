-- migrate:up
-- 중간 판단 알림 (L1, 기획서 결정 2026-11-17 · 2026-11-20): 소식에 판단의 모양(고른 안 · 다른 안 · 까닭 · 무게 · 단계)을 함께 둔다.
-- 판단(kind decision)만 쓰고 나머지 소식은 NULL. 소식은 추가만이라 칸을 더해도 지난 줄은 그대로다
ALTER TABLE task.chat_updates
  ADD COLUMN data jsonb CHECK (data IS NULL OR jsonb_typeof(data) = 'object');

-- migrate:down
ALTER TABLE task.chat_updates DROP COLUMN data;
