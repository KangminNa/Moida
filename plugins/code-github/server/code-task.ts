import {
  DomainEvent,
  NotFound,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { repos } from './schema';
import type { RepoRow } from './tables';

// 코드 작업 하나를 여는 규칙 (코드 작업 4단계 · 2026-11-15 C): 관리자가 코드 메뉴에서 맡길 때(RequestCode)와
// 에이전트의 요청이 승인됐을 때(StartAsked)가 같은 줄을 지난다. 작업은 코어가 만든다 (task.task.requested, kind code)

export const CODE_KIND = 'code';
export const PATHS_MAX = 20;
export const PATH_MAX = 200;
const TITLE_MAX = 120;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 막는 것이 목적이다
export const CONTROL = /[\u0000-\u001f\u007f]/;

/** 고칠 수 있는 곳: 저장소 안의 상대 경로 접두어. "."은 저장소 전체 (러너의 CodeSpec이 다시 본다) */
export function checkPaths(paths: readonly string[]): readonly string[] {
  const clean = paths.map((p) => p.trim().replace(/\/+$/, '')).filter(Boolean);
  if (clean.length === 0) throw new RuleViolation('고칠 수 있는 곳(paths)을 하나 이상 적어 주세요');
  const wrong = clean.filter(
    (p) =>
      p.startsWith('/') ||
      p.split('/').includes('..') ||
      CONTROL.test(p) ||
      p.toLowerCase().startsWith('.github/workflows'),
  );
  if (wrong.length > 0)
    throw new RuleViolation(
      `저장소 안의 상대 경로만 (.. · / 로 시작 · .github/workflows는 안 돼요): ${wrong.join(', ')}`,
    );
  return [...new Set(clean)];
}

export async function repoOf(work: Work, spaceId: string, id: string): Promise<RepoRow> {
  const row = await work.row(repos, { id, space_id: spaceId });
  if (!row) throw new NotFound('없는 저장소예요');
  return row;
}

/** 코드 작업을 여는 이벤트. 그때의 저장소 값(주소 · 기준 · 명령)이 작업에 실린다. 같은 requestId는 작업 하나 */
export function codeTaskRequested(
  space: string,
  repo: RepoRow,
  requestId: string,
  instruction: string,
  paths: readonly string[],
  agentId: string | null,
): DomainEvent {
  const first =
    instruction
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? '';
  return new DomainEvent('task.task.requested', 1, space, {
    requestId,
    kind: CODE_KIND,
    title: `${repo.name}: ${first}`.slice(0, TITLE_MAX),
    instruction,
    agentId,
    payload: {
      code: {
        repo: { id: repo.id, url: repo.url, base: repo.base },
        paths,
        setup: repo.setup,
        checks: repo.checks,
      },
    },
  });
}
