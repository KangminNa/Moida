-- migrate:up
-- 2차 7단계 외부 도구 꽂기 (서브나 10장): 새 서비스의 MCP 서버를 등록하고 에이전트마다 허락하면 러너가 그 일에만 붙인다.
-- 원격(HTTP) MCP만 받는다: stdio(npx 패키지)는 러너에 아무 코드나 설치하게 된다.
-- name: 러너 안의 MCP 서버 이름(x-<name>)과 에이전트의 허락 목록(agents.external_tools)이 쓰는 이름. 만든 뒤 바꾸지 않는다
-- url: https만. 내부망 · 이 서버 주소는 ExternalTool 규칙이 막는다
-- header_name: 토큰을 실어 보낼 머리글 (예: Authorization). 비었으면 토큰 없는 도구
-- secret · nonce: 머리글의 값을 서버 키로 잠근 것 (SecretBox). 화면 · AI · 로그 어디에도 다시 나오지 않는다
--   머리글이 있는데 토큰이 없으면 러너에 붙이지 않는다 ("토큰 필요")
-- status: proposed(AI의 제안, 결재 task.tool.plug를 기다림) · active · off(관리자가 끔)
-- note: 제안한 까닭 (AI가 적는다). proposed_by: 제안한 에이전트
CREATE TABLE task.external_tools (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9-]{1,29}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  url text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 500),
  header_name text CHECK (header_name ~ '^[A-Za-z0-9-]{1,40}$'),
  secret bytea,
  nonce bytea,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'off')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  proposed_by uuid REFERENCES task.agents (id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_tools_space_id_name_key UNIQUE (space_id, name),
  CONSTRAINT external_tools_secret_pair CHECK ((secret IS NULL) = (nonce IS NULL)),
  CONSTRAINT external_tools_secret_header CHECK (secret IS NULL OR header_name IS NOT NULL)
);

-- 에이전트마다 허락한 외부 도구의 이름 (scopes처럼 설정 판에 함께 남는다). 10개까지.
-- 비공개를 읽거나(read_all · write) 셸이 있는(code · make) 에이전트에는 두지 않는다: 바깥 서비스로 가는 길이라 browse와 같은 규칙
ALTER TABLE task.agents
  ADD COLUMN external_tools text[] NOT NULL DEFAULT '{}' CHECK (cardinality(external_tools) <= 10),
  ADD CONSTRAINT agents_tools_not_private CHECK (
    cardinality(external_tools) = 0 OR NOT (scopes && ARRAY['read_all', 'write', 'code', 'make']::text[])
  );

-- migrate:down
ALTER TABLE task.agents
  DROP CONSTRAINT agents_tools_not_private,
  DROP COLUMN external_tools;
DROP TABLE task.external_tools;
