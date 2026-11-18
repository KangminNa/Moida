-- migrate:up
-- 스토어 1-6 앱 코드 (docs/스토어.md 9장, 2026-11-18): 앱마다 자기 코드 묶음(HTML · CSS · JS · 그림)을 버전으로 쌓는다.
--   코드는 우리 서버에서 실행되지 않는다: 로직 없는 템플릿에 데이터를 채워 보낼 뿐이다 (웹이 그린다).
--   버전은 추가만 한다. 공개 앱의 새 버전은 확인 대기(code_pending_seq)로 두고 관리자가 공개한다 (원칙 7).
--   app_id는 값이다 (외래키 없음): 버전이 추가만이라 외래키를 걸면 코드를 고친 앱을 지울 수 없다. 앱을 지워도 버전은 남는다 (원칙 2).
CREATE TABLE blog.app_code_versions (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  app_id      uuid NOT NULL,                                                  -- blog.apps의 id (값)
  space_id    uuid NOT NULL,
  seq         int NOT NULL CHECK (seq >= 1),
  files       jsonb NOT NULL CHECK (jsonb_typeof(files) = 'array'),           -- [{ name, blobHash, mime, sizeBytes }] 페이지 버전과 같은 모양
  source      text NOT NULL CHECK (source IN ('starter', 'upload', 'task', 'restore')),
  task_id     uuid,                                                           -- 만든 작업 (task의 것, 값). source = 'task'일 때만
  run_id      uuid,                                                           -- 만든 실행 (task의 것, 값)
  note        text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),     -- 요청 글 · 올린 파일 이름
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_code_versions_seq UNIQUE (app_id, seq),
  CONSTRAINT app_code_versions_run UNIQUE (app_id, run_id),                  -- 같은 이벤트를 두 번 받아도 버전은 하나
  CONSTRAINT app_code_versions_task CHECK ((source = 'task') = (task_id IS NOT NULL AND run_id IS NOT NULL))
);
CREATE TRIGGER app_code_versions_append_only
  BEFORE UPDATE OR DELETE ON blog.app_code_versions
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- 앱의 지금 코드: 보이는 버전(NULL = 종류의 시작 코드) · 확인 대기 버전 · 쌓인 버전 수
ALTER TABLE blog.apps
  ADD COLUMN code_seq int,
  ADD COLUMN code_pending_seq int,
  ADD COLUMN code_versions int NOT NULL DEFAULT 0 CHECK (code_versions >= 0),
  ADD CONSTRAINT apps_code_seq CHECK (code_seq IS NULL OR code_seq BETWEEN 1 AND code_versions),
  ADD CONSTRAINT apps_code_pending CHECK (code_pending_seq IS NULL OR code_pending_seq BETWEEN 1 AND code_versions);

-- 한 앱의 코드를 고치는 일은 한 번에 하나 (대기 · 실행 · 기다림 중인 만들기 일의 payload.appCode.appId). 페이지와 같다
CREATE UNIQUE INDEX tasks_one_open_app_code ON task.tasks (space_id, (payload->'appCode'->>'appId'))
  WHERE status IN ('queued', 'running', 'waiting') AND payload->'appCode'->>'appId' IS NOT NULL;

-- migrate:down
DROP INDEX task.tasks_one_open_app_code;
ALTER TABLE blog.apps
  DROP CONSTRAINT apps_code_pending,
  DROP CONSTRAINT apps_code_seq,
  DROP COLUMN code_versions,
  DROP COLUMN code_pending_seq,
  DROP COLUMN code_seq;
DROP TABLE blog.app_code_versions;
