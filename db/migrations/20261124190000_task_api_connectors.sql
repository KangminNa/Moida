-- migrate:up
-- API 커넥터 (2026-11-24, 기획서 결정 "도구를 찾아 붙이기"): 원격 MCP가 없는 바깥 서비스(생성형 AI 등)의 REST API를
-- 일꾼이 쓴 정의서(spec, JSON)로 붙인다. 실행은 서버의 고정 코드(ApiCallGateway)가 하고 AI가 쓴 코드는 돌리지 않는다.
-- name: api_run이 부르는 이름. 만든 뒤 바꾸지 않는다
-- base: 정의서의 기본 주소 (https 출처 + 앞 경로). 요청은 이 출처로만 간다 (ApiSpec이 거른다).
--   http://127.0.0.1은 테스트의 가짜 서버만: 운영 서버는 시험 스위치 없이 http를 열지 않는다 (PublicHttpsGateway)
-- spec: 정의서 (ApiSpec이 거른 것). pending_spec: 일꾼이 낸 새 버전 (결재 task.api.plug를 기다림)
-- history: 앞 버전의 정의서 (최근 10개, 새 버전을 승인할 때 앞에 쌓는다)
-- secret · nonce: 정의서의 인증 머리글에 실을 키를 서버 키로 잠근 것 (SecretBox). 관리자가 콘솔에서만 넣는다
-- daily_max: 돈이 드는 동작(effect spend)을 하루(최근 24시간)에 부를 수 있는 횟수. 넘으면 부를 때마다 승인
-- source: 어디서 찾았는지 { kind: registry · docs · openapi · manual, url }
-- status: proposed(새 커넥터의 제안, 결재를 기다림) · active · off
CREATE TABLE task.api_connectors (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9-]{1,29}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  base text NOT NULL CHECK (base ~ '^(https://|http://127\.0\.0\.1[:/])' AND char_length(base) <= 300),
  spec jsonb NOT NULL,
  pending_spec jsonb,
  history jsonb NOT NULL DEFAULT '[]',
  secret bytea,
  nonce bytea,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'off')),
  daily_max integer NOT NULL DEFAULT 20 CHECK (daily_max BETWEEN 0 AND 1000),
  source jsonb NOT NULL DEFAULT '{}',
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  proposed_by uuid REFERENCES task.agents (id) ON DELETE SET NULL,
  last_used_at timestamptz,
  last_error text CHECK (char_length(last_error) <= 300),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_connectors_space_id_name_key UNIQUE (space_id, name),
  CONSTRAINT api_connectors_secret_pair CHECK ((secret IS NULL) = (nonce IS NULL)),
  CONSTRAINT api_connectors_spec_size CHECK (pg_column_size(spec) <= 65536)
);

-- API 부르기 한 번 (api_run · 관리자의 시험). 오래 걸리는 생성은 일꾼(ApiCallJob)이 next_at마다 상태를 다시 묻고,
-- 끝난 답의 파일 주소(file_urls)를 받아 결과물(outputs)로 남긴 뒤 주소는 지운다 (서명된 주소를 오래 들고 있지 않게).
-- status: held(승인을 기다림) · running(첫 요청 중) · polling(상태를 다시 묻는 중) · fetching(파일을 받는 중) · done · failed · refused(승인 안 됨)
-- effect: 정의서의 동작 성격 (read · spend · write). spend는 하루 한도로 센다
-- task_id · run_id: 부른 일과 그 실행 (결과물이 그 실행에 붙는다). 관리자의 시험은 둘 다 없다
-- request_id: 같은 요청은 한 번 (작업마다, 관리자는 공간마다)
-- answer: AI에게 돌려주는 답 (정의서의 pick, 20KB까지). vars: 상태 묻기의 주소를 채울 값
CREATE TABLE task.api_calls (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  connector_id uuid NOT NULL REFERENCES task.api_connectors (id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 40),
  effect text NOT NULL CHECK (effect IN ('read', 'spend', 'write')),
  task_id uuid REFERENCES task.tasks (id) ON DELETE SET NULL,
  run_id uuid,
  agent_id uuid REFERENCES task.agents (id) ON DELETE SET NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  input jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('held', 'running', 'polling', 'fetching', 'done', 'failed', 'refused')),
  held_reason text CHECK (held_reason IN ('write', 'limit')),
  approval_id uuid,
  answer jsonb,
  vars jsonb NOT NULL DEFAULT '{}',
  file_urls text[] NOT NULL DEFAULT '{}' CHECK (cardinality(file_urls) <= 10),
  output_ids uuid[] NOT NULL DEFAULT '{}',
  error text CHECK (char_length(error) <= 500),
  polls integer NOT NULL DEFAULT 0,
  next_at timestamptz,
  give_up_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT api_calls_request_key UNIQUE (space_id, request_id),
  CONSTRAINT api_calls_input_size CHECK (pg_column_size(input) <= 32768)
);
-- 일꾼이 다시 물을 때가 된 부르기를 찾는다 (ApiCallJob)
CREATE INDEX api_calls_due ON task.api_calls (next_at) WHERE next_at IS NOT NULL;
-- 하루 한도: 커넥터의 최근 24시간 spend 수 (ApiCallRepository.spentSince)
CREATE INDEX api_calls_spend ON task.api_calls (connector_id, created_at) WHERE effect = 'spend';

-- migrate:down
DROP TABLE task.api_calls;
DROP TABLE task.api_connectors;
