-- migrate:up
-- 앱 데이터 (docs/스토어.md 12.4): 앱이 cairn.json에 선언한 표의 목록. 실제 표는 앱마다의 스키마 app_<앱 id>에 있고
-- (서버가 보이는 버전에 맞춰 만든다), 회원 쪽 API는 이 목록에 있는 이름만 SQL에 쓴다.
-- open: 지금 보이는 버전이 선언했는가 (선언에서 빠진 표는 닫히고 DB에는 남는다, 원칙 2)
CREATE TABLE community.app_tables (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  app_id      uuid NOT NULL,
  name        text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{0,39}$'),
  columns     jsonb NOT NULL,
  read_rule   text NOT NULL CHECK (read_rule IN ('anyone', 'member', 'owner', 'admin')),
  write_rule  text NOT NULL CHECK (write_rule IN ('member', 'owner', 'admin')),
  open        boolean NOT NULL DEFAULT true,
  applied_seq integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  UNIQUE (app_id, name)
);

-- 회원 쪽 API가 쿼리할 때 잠깐 쓰는 역할 (SET LOCAL ROLE): 앱 스키마의 표에만 권한이 있어 행 수준 보안이 걸린다.
-- 역할은 DB가 아니라 서버 전체의 것이라 이미 있으면 그대로 쓴다 (테스트 DB를 여러 개 두는 서버)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cairn_app') THEN
    CREATE ROLE cairn_app NOLOGIN;
  END IF;
END
$$;
GRANT cairn_app TO CURRENT_USER;

-- migrate:down
DROP TABLE community.app_tables;
-- 역할은 다른 DB도 쓸 수 있어 여기서는 권한이 남아 있지 않을 때만 지운다 (앱 스키마는 남긴다: 데이터를 지우지 않는다)
DO $$
BEGIN
  DROP ROLE IF EXISTS cairn_app;
EXCEPTION WHEN dependent_objects_still_exist OR object_in_use THEN
  NULL;
END
$$;
