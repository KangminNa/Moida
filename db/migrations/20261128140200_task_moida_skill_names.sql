-- migrate:up
-- 이름 cairn → moida (2026-11-28, 기획서 결정): 러너 스킬의 콘솔 판 이름 cairn-… → moida-… (저장소 skills/의 폴더와 같게).
-- 콘솔에서 고친 판을 쓰는 스킬은 그 판의 글도 새 이름으로 바꾼 새 판을 하나 쌓아 쓴다 (판은 추가만, 앞 판은 그대로):
-- SKILL.md 앞부분의 name · moida-where가 새 이름이어야 서버(SkillFiles)와 AI 도구가 그 스킬로 알아본다.
-- 새 판의 메모에 앞에 쓰던 판 번호를 남겨 down이 되돌린다. 실행 기록(task_runs.skill)은 추가만 하는 표라 옛 이름 그대로
-- 두고, 스킬의 성적표가 옛 이름도 함께 센다 (SkillQuery)
UPDATE task.skills
SET name = 'moida-' || substr(name, 7), version = version + 1, updated_at = now()
WHERE name LIKE 'cairn-%';

WITH renamed AS (
  SELECT s.id AS skill_id, s.revisions + 1 AS revision, s.active_revision AS was,
    (SELECT jsonb_object_agg(f.key,
       replace(replace(replace(f.value, 'cairn', 'moida'), 'Cairn', 'Moida'), 'CAIRN', 'MOIDA'))
     FROM jsonb_each_text(r.files) f) AS files,
    r.based_on
  FROM task.skills s
  JOIN task.skill_revisions r ON r.skill_id = s.id AND r.revision = s.active_revision
  WHERE s.name LIKE 'moida-%' AND r.files::text ~* 'cairn'
), added AS (
  INSERT INTO task.skill_revisions (skill_id, revision, files, hash, based_on, note)
  SELECT n.skill_id, n.revision, n.files,
    (SELECT encode(digest(string_agg(
       convert_to(f.key, 'UTF8') || '\x00'::bytea || convert_to(f.value, 'UTF8') || '\x00'::bytea,
       ''::bytea ORDER BY f.key COLLATE "C"), 'sha256'), 'hex')
     FROM jsonb_each_text(n.files) f),
    n.based_on,
    '이름 cairn → moida (마이그레이션, 앞 판 ' || n.was || ')'
  FROM renamed n
  RETURNING skill_id, revision
)
UPDATE task.skills s
SET revisions = a.revision, active_revision = a.revision, version = s.version + 1, updated_at = now()
FROM added a WHERE s.id = a.skill_id;

-- migrate:down
-- up이 쌓은 판을 지우고 앞에 쓰던 판으로 돌린 뒤 이름을 되돌린다. 판 표는 추가만 하는 표라 지우기를 이 트랜잭션에서만 연다
SET LOCAL cairn.allow_purge = 'on';
WITH added AS (
  SELECT r.skill_id, r.revision, substring(r.note FROM '앞 판 ([0-9]+)\)$')::int AS was
  FROM task.skill_revisions r JOIN task.skills s ON s.id = r.skill_id AND s.revisions = r.revision
  WHERE r.note LIKE '이름 cairn → moida (마이그레이션, 앞 판 %)'
), reverted AS (
  UPDATE task.skills s
  SET revisions = a.revision - 1, active_revision = a.was, version = s.version + 1, updated_at = now()
  FROM added a WHERE s.id = a.skill_id
  RETURNING s.id
)
DELETE FROM task.skill_revisions r USING added a
WHERE r.skill_id = a.skill_id AND r.revision = a.revision;
UPDATE task.skills
SET name = 'cairn-' || substr(name, 7), version = version + 1, updated_at = now()
WHERE name LIKE 'moida-%';
