import type { Agent } from '../agent/agent';
import type { SkillPackage } from '../skill/skill-package';
import type { TaskRow, TaskRunNew, TaskRunRow } from '../task.tables';
import { JobRunView } from './job.view';
import { RunLineage } from './run-lineage.policy';

// 실행 기록 한 줄 (task.task_runs): 이번 실행이 어떤 규칙으로 돌았나.
// 에이전트 설정 판, 스킬 판(출처 · 판 번호 · 해시), 지시문 틀(moida-runner)의 판, 러너 빌드, CLI 버전, 세션 키(RunLineage).
// 일을 빌려 줄 때 한 번 만든다. CLI 세션 id · 재개했는지는 러너의 첫 보고가 채운다 (TaskRepository.noteRun)
export class RunRecord {
  /** row()가 만든 줄과 그 작업의 종류 (일을 빌려 줄 때 한 번 만든다) */
  private made: TaskRunNew | null = null;
  private kind = '';

  constructor(
    private readonly agent: Agent | null,
    private readonly skill: SkillPackage | null,
    /** 지시문 틀의 판. 에이전트 없는 일은 null */
    private readonly prompt: SkillPackage | null,
    private readonly runnerBuild: string | null,
    private readonly cliVersion: string | null,
  ) {}

  /** 그 작업(빌린 뒤의 줄) · 러너의 줄. 몇 번째 실행인지(seq)는 Repository가 매긴다 */
  row(id: string, task: TaskRow, runnerId: string, now: Date): TaskRunNew {
    this.kind = task.kind;
    this.made = {
      id,
      space_id: task.space_id,
      task_id: task.id,
      seq: 0,
      runner_id: runnerId,
      agent_id: this.agent?.id ?? null,
      agent_revision: this.agent?.settingsRevision ?? null,
      skill: this.skill?.name ?? null,
      skill_source: this.skill?.source ?? null,
      skill_revision: this.skill?.revision ?? null,
      skill_hash: this.skill?.hash ?? null,
      prompt_source: this.prompt?.source ?? null,
      prompt_revision: this.prompt?.revision ?? null,
      prompt_hash: this.prompt?.hash ?? null,
      runner_build: this.runnerBuild,
      cli_version: this.cliVersion,
      started_at: now,
      lineage: RunLineage.of(task),
    };
    return this.made;
  }

  /**
   * 러너에게 알릴 이번 실행 (next_jobs의 run): 세션 키, 세션 파일을 남겨도 되는지, 재개할 CLI 세션.
   * before는 같은 세션 키의 바로 앞 실행. 기록하지 않는 일이면 null
   */
  jobView(before: TaskRunRow | null): JobRunView | null {
    const run = this.made;
    if (run === null || !run.lineage) return null;
    const keeps = RunLineage.keeps(this.kind);
    return new JobRunView(run.lineage, keeps, RunLineage.resumeOf(run, before, keeps));
  }
}
