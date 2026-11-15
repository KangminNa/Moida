-- migrate:up
-- 2차 7단계 정리 넓히기 (서브나 10장): 세션 정리를 저장할 때마다(save) 또는 하루 한 번 몰아서(daily).
-- 하루 한 번이면 일꾼(TidyDailyJob)이 새 판이 쌓인 세션을 한 묶음 요청하고 daily_at에 그때를 적는다.
-- 기본은 daily: 저장마다 구독 토큰을 쓰지 않고, 하루치 판을 한 번에 정리한다
ALTER TABLE vault.tidy_settings
  ADD COLUMN cadence text NOT NULL DEFAULT 'daily' CHECK (cadence IN ('save', 'daily')),
  ADD COLUMN daily_at timestamptz;

-- migrate:down
ALTER TABLE vault.tidy_settings
  DROP COLUMN daily_at,
  DROP COLUMN cadence;
