-- migrate:up
-- 로그인 카드 (2026-11-19 사용자 결정, 원칙 8을 바꿈): 사람이 해야 하는 로그인을 카드의 칸으로 받는다.
-- login_form: AI가 본 로그인 화면의 칸 (종류 · 접근성 역할 · 이름, 로그인 단추, 그 화면의 주소, 그 화면을 연 러너). 값은 없다:
--   관리자가 카드의 칸에 넣은 값은 서버 메모리에만 10분 두고, 그 러너(AI 없음)가 꺼내 가면 지운다. DB에는 남지 않는다.
--   믿는 출처일 때만 적는다 (아래). 아니면 비워 두고 카드는 화면에서 직접 로그인하게 한다
-- trusted_at: 이 사이트의 출처를 관리자가 믿는다고 한 때. 직접 등록했거나, 화면에서 로그인하고 "로그인했어요"를 눌렀을 때.
--   둘러보기가 저절로 만든 사이트(등록 없이)는 비어 있다: 페이지에 심은 글이 AI를 가짜 로그인 화면으로 데려가도 칸이 뜨지 않게
ALTER TABLE browser_tabs.sites
  ADD COLUMN login_form jsonb CHECK (login_form IS NULL OR jsonb_typeof(login_form) = 'object'),
  ADD COLUMN trusted_at timestamptz;

-- 지금까지의 사이트는 모두 관리자가 직접 등록했다
UPDATE browser_tabs.sites SET trusted_at = created_at;

-- migrate:down
ALTER TABLE browser_tabs.sites DROP COLUMN login_form, DROP COLUMN trusted_at;
