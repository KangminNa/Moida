-- migrate:up
-- 앱 플랫폼 (docs/스토어.md 12장): 보이는 버전의 선언서(cairn.json)를 정리한 모양으로 앱 줄에 둔다.
-- 회원을 받는 앱인지(members) · 고정 화면의 테마(theme) · 표 선언(tables)을 다른 모듈과 웹이 파일을 열지 않고 읽는다.
-- 보이는 버전이 바뀔 때(AppCode.add · show) 함께 바뀐다. 이 칸이 생기기 전의 버전은 빈 값이다 (그 버전들에는 새 이름이 없다)
ALTER TABLE blog.apps ADD COLUMN code_manifest jsonb NOT NULL DEFAULT '{}';

-- migrate:down
ALTER TABLE blog.apps DROP COLUMN code_manifest;
