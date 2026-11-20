-- migrate:up
-- 러너의 동시 자리 (2026-11-20): 콘솔(러너 메뉴)에서 정한 동시에 하는 일의 수. 비우면 러너가 띄울 때의 값(CAIRN_RUNNER_CONCURRENCY,
-- 서버 러너 3 · 내 컴퓨터 1)을 쓴다. 러너는 next_jobs의 답으로 받아 바로 바꾼다. 코드 러너 칸은 늘 1이라 정하지 않는다
ALTER TABLE task.runners
  ADD COLUMN concurrency smallint
    CONSTRAINT runners_concurrency_range CHECK (concurrency BETWEEN 1 AND 8),
  ADD CONSTRAINT runners_sandbox_single CHECK (NOT sandbox OR concurrency IS NULL);

-- migrate:down
ALTER TABLE task.runners DROP CONSTRAINT runners_sandbox_single, DROP COLUMN concurrency;
