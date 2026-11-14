-- migrate:up
-- 2차 5단계 자라는 페이지 (서브나 9장): 계속 쓸 결과물(여행지도 · 현황판)이 스케줄로 새 버전이 된다.

-- 방향: 관리자만 고치는 이 페이지의 쓰임 (새 버전을 만드는 AI가 지시와 함께 읽는다)
-- pending_seq: 공개 페이지의 새 버전은 바로 보이지 않고 관리자가 "이 버전 보이기"를 누를 때까지 기다린다 (원칙 7)
ALTER TABLE blog.pages
  ADD COLUMN direction text NOT NULL DEFAULT '' CHECK (char_length(direction) <= 4000),
  ADD COLUMN pending_seq int CHECK (pending_seq IS NULL OR pending_seq BETWEEN 1 AND revisions);

-- 스케줄이 가리키는 페이지 (값, blog의 것이라 외래키 없음): 때가 되면 그 페이지의 새 버전을 만드는 만들기 일
ALTER TABLE task.schedules ADD COLUMN page_id uuid;

-- 한 페이지를 고치는 일은 한 번에 하나 (대기 · 실행 · 기다림 중인 만들기 일의 payload.page.pageId)
CREATE UNIQUE INDEX tasks_one_open_page ON task.tasks (space_id, (payload->'page'->>'pageId'))
  WHERE status IN ('queued', 'running', 'waiting') AND payload->'page'->>'pageId' IS NOT NULL;

-- migrate:down
DROP INDEX task.tasks_one_open_page;
ALTER TABLE task.schedules DROP COLUMN page_id;
ALTER TABLE blog.pages DROP COLUMN pending_seq, DROP COLUMN direction;
