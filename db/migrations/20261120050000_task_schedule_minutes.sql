-- migrate:up
-- N분마다 (2026-11-20): 주기 minutely, 간격 every_minutes(5~720분, 시간대 기준 자정부터 N분 간격).
-- 하루 한도는 5분마다 하루 내내 돌 수 있게 288번까지 넓힌다
ALTER TABLE task.schedules
  ADD COLUMN every_minutes int CHECK (every_minutes BETWEEN 5 AND 720),
  DROP CONSTRAINT schedules_mode_check,
  ADD CONSTRAINT schedules_mode_check CHECK (mode IN ('daily', 'hourly', 'minutely')),
  ADD CONSTRAINT schedules_minutely_check CHECK ((mode = 'minutely') = (every_minutes IS NOT NULL)),
  DROP CONSTRAINT schedules_daily_max_check,
  ADD CONSTRAINT schedules_daily_max_check CHECK (daily_max BETWEEN 1 AND 288);

-- migrate:down
UPDATE task.schedules
  SET mode = 'hourly', every_hours = LEAST(24, GREATEST(1, every_minutes / 60)), every_minutes = NULL
  WHERE mode = 'minutely';
UPDATE task.schedules SET daily_max = 24 WHERE daily_max > 24;
ALTER TABLE task.schedules
  DROP CONSTRAINT schedules_daily_max_check,
  ADD CONSTRAINT schedules_daily_max_check CHECK (daily_max BETWEEN 1 AND 24),
  DROP CONSTRAINT schedules_minutely_check,
  DROP CONSTRAINT schedules_mode_check,
  ADD CONSTRAINT schedules_mode_check CHECK (mode IN ('daily', 'hourly')),
  DROP COLUMN every_minutes;
