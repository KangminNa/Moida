-- migrate:up
-- 이름 cairn → moida (2026-11-28, 기획서 결정): 앱 데이터의 회원 쪽 역할 cairn_app → moida_app, 행 수준 보안의 설정 이름
-- cairn.member → moida.member, 정책 이름 cairn_* → moida_*. 역할은 서버 전체의 것이라 이름을 바꾸지 않고 새로 만든다
-- (개발 DB와 테스트 DB가 같은 서버에 있으면 한쪽의 이름 바꾸기가 다른 쪽의 옛 코드를 멈춘다). 옛 역할은 그대로 둔다.
-- 이 DB의 앱 스키마(app_<앱 id>)마다 새 역할에 권한을 주고 정책을 새 이름 · 새 설정으로 다시 건다 (데이터는 그대로).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'moida_app') THEN
    CREATE ROLE moida_app NOLOGIN;
  END IF;
END
$$;
GRANT moida_app TO CURRENT_USER;

DO $$
DECLARE
  s record;
  p record;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'app\_%' LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO moida_app', s.nspname);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO moida_app', s.nspname);
  END LOOP;
  FOR p IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check FROM pg_policies
    WHERE schemaname LIKE 'app\_%' AND policyname LIKE 'cairn\_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      'moida_' || substr(p.policyname, 7), p.schemaname, p.tablename);
    EXECUTE format('CREATE POLICY %I ON %I.%I FOR %s TO moida_app%s%s',
      'moida_' || substr(p.policyname, 7), p.schemaname, p.tablename, p.cmd,
      CASE WHEN p.qual IS NULL THEN ''
        ELSE ' USING (' || replace(p.qual, 'cairn.member', 'moida.member') || ')' END,
      CASE WHEN p.with_check IS NULL THEN ''
        ELSE ' WITH CHECK (' || replace(p.with_check, 'cairn.member', 'moida.member') || ')' END);
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END
$$;

-- migrate:down
-- 정책을 옛 이름 · 옛 설정 · 옛 역할로 되돌린다. 새 역할은 다른 DB도 쓸 수 있어 권한이 남아 있지 않을 때만 지운다
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check FROM pg_policies
    WHERE schemaname LIKE 'app\_%' AND policyname LIKE 'moida\_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      'cairn_' || substr(p.policyname, 7), p.schemaname, p.tablename);
    EXECUTE format('CREATE POLICY %I ON %I.%I FOR %s TO cairn_app%s%s',
      'cairn_' || substr(p.policyname, 7), p.schemaname, p.tablename, p.cmd,
      CASE WHEN p.qual IS NULL THEN ''
        ELSE ' USING (' || replace(p.qual, 'moida.member', 'cairn.member') || ')' END,
      CASE WHEN p.with_check IS NULL THEN ''
        ELSE ' WITH CHECK (' || replace(p.with_check, 'moida.member', 'cairn.member') || ')' END);
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END
$$;
DO $$
DECLARE
  s record;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'app\_%' LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM moida_app', s.nspname);
    EXECUTE format('REVOKE USAGE ON SCHEMA %I FROM moida_app', s.nspname);
  END LOOP;
  DROP ROLE IF EXISTS moida_app;
EXCEPTION WHEN dependent_objects_still_exist OR object_in_use THEN
  NULL;
END
$$;
