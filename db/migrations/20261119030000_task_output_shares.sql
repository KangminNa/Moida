-- migrate:up
-- 결과물 공유 링크 (기획서 결정 2026-11-19): 관리자가 결과물 하나를 로그인 없이 볼 수 있는 링크로 기간을 정해 연다.
-- 링크의 토큰은 저장하지 않는다: 서버 키에서 이 용도로 나눈 열쇠로 공유 id에 서명한 값이다 (ShareLink).
-- 끄면 ended_at, 기간(1 · 7 · 30일)이 지나면 열리지 않는다. 결과물을 바로 지우면 함께 지운다
CREATE TABLE task.output_shares (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id    uuid NOT NULL,
  output_id   uuid NOT NULL REFERENCES task.outputs(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT output_shares_period CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '31 days'
  )
);
-- 결과물마다 링크 (공유 칸), 공간마다 살아 있는 링크 (공유 중 목록)
CREATE INDEX output_shares_output ON task.output_shares (output_id, id DESC);
CREATE INDEX output_shares_live ON task.output_shares (space_id, id DESC) WHERE ended_at IS NULL;

-- migrate:down
DROP TABLE task.output_shares;
