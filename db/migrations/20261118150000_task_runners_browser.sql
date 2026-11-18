-- migrate:up
-- 러너 목록의 "브라우저" 표시 (O-1, docs/서브나.md 14장, 2026-11-18): 러너가 next_jobs에서 마지막으로 알린 browser 값.
--   서버 브라우저에 붙은 서버 러너만 참을 알린다. 사이트 일이 도는 동안에는 러너가 거짓을 알리므로,
--   목록은 이 값과 "쥔 실행 중인 브라우저 작업"을 함께 본다 (RunnerQuery). 진행 보고 · 로그인은 이 값을 바꾸지 않는다
ALTER TABLE task.runners ADD COLUMN browser boolean NOT NULL DEFAULT false;

-- migrate:down
ALTER TABLE task.runners DROP COLUMN browser;
