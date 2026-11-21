-- migrate:up
-- C1 OAuth 커넥터 (2026-11-21, docs/MCP.md 8장): 공식 원격 MCP의 OAuth 로그인(승인 코드 + PKCE)을 서버가 연다.
-- auth: header(고정 토큰: header_name · secret, 지금까지의 방식) · oauth(로그인). oauth면 머리글 · 토큰 칸을 쓰지 않는다
-- oauth: 로그인 서버 정보 중 비밀이 아닌 값만 (issuer · authorization_endpoint · token_endpoint · registration_endpoint ·
--   scope · client_id · redirect_uri). 로그인을 시작할 때마다 다시 찾고, 등록한 client_id는 로그인 서버 · 돌아올 주소가 같으면 다시 쓴다
-- oauth_pending: 시작한 로그인의 state와 PKCE 검증값을 용도(커넥터 id)에 묶어 서버 키로 싼 값 (SecretBox.pack, 10분).
--   돌아오면 맞춰 보고 한 번 쓰고 지운다. 검증값은 서버 밖으로 나가지 않는다
-- token · token_nonce: 받은 접근 토큰 · 갱신 토큰을 서버 키로 잠근 것 (SecretBox.seal). 화면 · AI · 로그 어디에도 다시 나오지 않고,
--   러너에는 일을 빌려 줄 때 접근 토큰만 Authorization: Bearer로 간다
-- token_expires_at: 접근 토큰이 끝나는 때 (로그인 서버가 알려 주지 않으면 NULL)
-- token_refresh_at: 일꾼(ExternalToolRefreshJob)이 다시 볼 때. 갱신 · 잠깐 실패한 갱신을 다시 · 갱신 토큰 없이 끝남 (할 일이 없으면 NULL)
-- oauth_error: 마지막 로그인 · 갱신 실패 까닭 (성공하면 NULL). 토큰이 없는 oauth 커넥터는 화면에서 "로그인 필요"
-- 로그인 칸은 버전 없이 적는다 (관리자의 고치기와 겨루지 않게, catalog · checked_at과 같다)
ALTER TABLE task.external_tools
  ADD COLUMN auth text NOT NULL DEFAULT 'header' CHECK (auth IN ('header', 'oauth')),
  ADD COLUMN oauth jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(oauth) = 'object'),
  ADD COLUMN oauth_pending text CHECK (char_length(oauth_pending) <= 2000),
  ADD COLUMN token bytea,
  ADD COLUMN token_nonce bytea,
  ADD COLUMN token_expires_at timestamptz,
  ADD COLUMN token_refresh_at timestamptz,
  ADD COLUMN oauth_error text CHECK (char_length(oauth_error) BETWEEN 1 AND 300),
  ADD CONSTRAINT external_tools_token_pair CHECK ((token IS NULL) = (token_nonce IS NULL)),
  ADD CONSTRAINT external_tools_token_times CHECK (
    token IS NOT NULL OR (token_expires_at IS NULL AND token_refresh_at IS NULL)
  ),
  ADD CONSTRAINT external_tools_login_oauth CHECK (
    auth = 'oauth' OR (token IS NULL AND oauth_pending IS NULL)
  ),
  ADD CONSTRAINT external_tools_oauth_header CHECK (
    auth = 'header' OR (header_name IS NULL AND secret IS NULL)
  );

-- migrate:down
ALTER TABLE task.external_tools
  DROP CONSTRAINT external_tools_oauth_header,
  DROP CONSTRAINT external_tools_login_oauth,
  DROP CONSTRAINT external_tools_token_times,
  DROP CONSTRAINT external_tools_token_pair,
  DROP COLUMN oauth_error,
  DROP COLUMN token_refresh_at,
  DROP COLUMN token_expires_at,
  DROP COLUMN token_nonce,
  DROP COLUMN token,
  DROP COLUMN oauth_pending,
  DROP COLUMN oauth,
  DROP COLUMN auth;
