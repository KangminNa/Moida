-- migrate:up
-- 기존 기기의 권한을 업무용으로 (2026-11-27, 사용자 "기존 기기 권한도 업무용으로 바꿔줘").
-- 승인 화면의 권한 묶음(DeviceScopes.PRESETS)이 생기기 전에 연결한 기기는 기본 권한(올리기 + 공개 읽기)뿐이었다.
-- 끊지 않았고 권한이 정확히 그 둘인 기기만 업무용(올리기 · 비공개 읽기 · 쓰기 · 맡기기 · 승인 대기 보기)으로 바꾼다.
-- 권한이 다른 기기(확장 · 수집 · 소식 · 배포 · 러너 · 코드 러너 칸, 관리자가 고친 기기)는 그대로 둔다.
-- 순서는 Device.ALL_SCOPES와 같게 둔다. 되돌릴 수 있게 meta에 바꾼 때를 적는다
UPDATE account.devices
SET scopes = ARRAY['upload', 'read_all', 'write', 'delegate', 'inbox']::text[],
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('work_preset_from', '2026-11-27'),
    version = version + 1
WHERE revoked_at IS NULL
  AND scopes = ARRAY['upload', 'read_public']::text[];

-- migrate:down
-- 이 마이그레이션이 바꾼 기기 중 그 뒤로 권한을 고치지 않은 것만 기본 권한으로 되돌린다
UPDATE account.devices
SET scopes = ARRAY['upload', 'read_public']::text[],
    meta = meta - 'work_preset_from',
    version = version + 1
WHERE meta ? 'work_preset_from'
  AND scopes = ARRAY['upload', 'read_all', 'write', 'delegate', 'inbox']::text[];
