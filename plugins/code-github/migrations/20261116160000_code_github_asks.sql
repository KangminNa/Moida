-- migrate:up
-- 코드 작업 열기 (2026-11-15 C): 에이전트가 대화에서 낸 코드 작업 요청 (MCP code_ask_task).
-- 에이전트가 이 줄의 id · version으로 결재(code.task.start, 대상 code_github_ask)를 올리고, 승인되면 관리자가 코드 메뉴에서
-- 맡길 때와 같은 코드 작업을 연다 (StartAsked). 반려 · 수정 요청 · 취소면 dropped. 줄은 지우지 않는다 (결재가 가리킨다).
-- agent_id(맡길 에이전트) · asked_by(요청한 에이전트) · approval_id(시작한 결재)는 코어의 값이라 외래키 없이 값으로만
CREATE TABLE code_github.task_asks (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  repo_id uuid NOT NULL REFERENCES code_github.repos(id),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 100),
  paths text[] NOT NULL CHECK (cardinality(paths) BETWEEN 1 AND 20),
  instruction text NOT NULL CHECK (char_length(instruction) BETWEEN 1 AND 20000),
  agent_id uuid,
  asked_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'asked' CHECK (status IN ('asked', 'started', 'dropped')),
  approval_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 같은 에이전트의 같은 요청은 한 줄 (응답을 못 받아 다시 보내도)
  CONSTRAINT task_asks_request_once UNIQUE (space_id, asked_by, request_id),
  CONSTRAINT task_asks_started CHECK ((status = 'started') = (approval_id IS NOT NULL))
);
CREATE INDEX task_asks_space_idx ON code_github.task_asks (space_id, id DESC);

-- migrate:down
DROP TABLE code_github.task_asks;
