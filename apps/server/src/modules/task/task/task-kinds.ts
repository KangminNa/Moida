import { RuleViolation } from '../../platform';
import KINDS from '../task-kinds.json';

// 작업 종류 한 파일 (리팩토링 R3a, task/task-kinds.json): 종류마다
//   scopes     맡을 에이전트에게 있어야 하는 권한 (없으면 누구나)
//   skill      러너에게 함께 보내는 스킬 (skills/<이름>)
//   delegable  delegate_task로 맡길 수 있다
//   sandboxed  셸이 있는 코드 러너 칸에서만 돈다 (칸은 이 일만 받는다)
//   agentless  에이전트 · 작업 토큰 없이 러너가 바로 돈다 (연결 확인 · 로그인 · 세션 노트 · 커넥터 확인)
//   plugin     이 일에 꼭 있어야 하는 플러그인과 그 도구 (러너가 일을 시작하며 부른다). 동작하지 않으면 만들지 않는다 (assertReady)
//   recorded   false면 에이전트의 일이어도 작업 세션에 원문 · 인수인계 메모를 남기지 않는다 (세션 정리: 정리 일이 또 정리할 세션이 되지 않게,
//              기획서 결정 2026-11-17). 에이전트 없는 일도 남기지 않는다
// Task는 여기서 목록을 만든다. 시험이 권한 이름 · 스킬 폴더를 맞춰 보고, 러너 시험이 러너가 아는 종류가 다 있는지 본다.
// 종류를 더하면: 이 파일 한 줄 + 그 일을 하는 러너 단계 · 스킬 (task/CLAUDE.md)

/** 작업 종류 이름 (task-kinds.json의 열쇠) */
export type TaskKind = keyof typeof KINDS;

// biome-ignore lint/complexity/noStaticOnlyClass: 작업 종류의 목록을 한 파일에서 만드는 한 곳
export class TaskKinds {
  private static readonly ALL = KINDS as Readonly<
    Record<
      TaskKind,
      {
        scopes?: readonly string[];
        skill?: string;
        delegable?: boolean;
        sandboxed?: boolean;
        agentless?: boolean;
        recorded?: boolean;
        plugin?: { name: string; tool: string };
      }
    >
  >;
  static readonly NAMES = Object.keys(TaskKinds.ALL) as readonly TaskKind[];
  static readonly AGENTLESS: readonly string[] = TaskKinds.NAMES.filter(
    (k) => TaskKinds.ALL[k].agentless,
  );
  static readonly SANDBOXED: readonly string[] = TaskKinds.NAMES.filter(
    (k) => TaskKinds.ALL[k].sandboxed,
  );
  /** 작업 세션에 실행을 기록하지 않는 종류: 에이전트 없는 일과 recorded가 false인 일 */
  static readonly UNRECORDED: readonly string[] = TaskKinds.NAMES.filter(
    (k) => TaskKinds.ALL[k].agentless || TaskKinds.ALL[k].recorded === false,
  );
  static readonly DELEGABLE: readonly string[] = TaskKinds.NAMES.filter(
    (k) => TaskKinds.ALL[k].delegable,
  );
  /** 종류 → 스킬 이름 (스킬이 있는 종류만) */
  static readonly SKILLS: Readonly<Record<string, string>> = Object.fromEntries(
    TaskKinds.NAMES.flatMap((k) => {
      const skill = TaskKinds.ALL[k].skill;
      return skill ? [[k, skill]] : [];
    }),
  );
  /** 종류 → 필요한 권한 (권한이 있어야 하는 종류만) */
  static readonly SCOPES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
    TaskKinds.NAMES.flatMap((k) => {
      const scopes = TaskKinds.ALL[k].scopes;
      return scopes ? [[k, scopes]] : [];
    }),
  );

  /**
   * 그 종류에 꼭 있어야 하는 플러그인이 동작하는가 (running: 동작 중인 기능 패키지의 도구, PluginRegistry.packageTools).
   * 아니면 RuleViolation: 러너가 빌려 가 "도구가 없어요"로 실패하기 전에, 맡기는 쪽(관리자 · 팀장)이 까닭을 바로 받는다 (2026-11-21)
   */
  static assertReady(kinds: readonly string[], running: readonly { name: string }[]): void {
    for (const kind of kinds) {
      const plugin = (TaskKinds.ALL as Record<string, { plugin?: { name: string; tool: string } }>)[
        kind
      ]?.plugin;
      if (plugin && !running.some((t) => t.name === plugin.tool))
        throw new RuleViolation(
          `${kind} 일은 ${plugin.name} 플러그인이 동작해야 해요. 설정 › 플러그인에서 켜 주세요`,
        );
    }
  }
}
