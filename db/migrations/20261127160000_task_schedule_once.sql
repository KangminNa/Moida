-- migrate:up
-- 한 번 실행 스케줄 (2026-11-27, 사용자 "스케줄은 캘린더 형태로 나타내서 캘린더에 맞춰서 일을 등록해둘 수도 있나?").
-- 주기 once: 정한 시각(run_at) 한 번만 돌고 저절로 꺼진다 (다음 시각이 없다). 캘린더의 날짜를 눌러 등록한다
ALTER TABLE task.schedules
  ADD COLUMN run_at timestamptz,
  DROP CONSTRAINT schedules_mode_check,
  ADD CONSTRAINT schedules_mode_check CHECK (mode IN ('daily', 'hourly', 'minutely', 'once')),
  ADD CONSTRAINT schedules_once_check CHECK ((mode = 'once') = (run_at IS NOT NULL));

-- migrate:down
DELETE FROM task.schedules WHERE mode = 'once';
ALTER TABLE task.schedules
  DROP CONSTRAINT schedules_once_check,
  DROP CONSTRAINT schedules_mode_check,
  ADD CONSTRAINT schedules_mode_check CHECK (mode IN ('daily', 'hourly', 'minutely')),
  DROP COLUMN run_at;
