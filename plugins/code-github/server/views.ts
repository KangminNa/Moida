import type { PullRow, RepoRow, TaskAskRow } from './tables';

// 이 패키지가 내보내는 모양. 보는 사람마다 나눈다: 콘솔(주인)은 camelCase, 러너(MCP)는 snake_case.

/** 등록한 저장소 하나 (콘솔) */
export class RepoView {
  constructor(private readonly row: Readonly<RepoRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      url: r.url,
      base: r.base,
      setup: r.setup,
      checks: r.checks,
      archivedAt: r.archived_at?.toISOString() ?? null,
      version: r.version,
    };
  }
}

/** 저장소 목록 (콘솔) */
export class RepoListView {
  constructor(private readonly repos: readonly RepoView[]) {}

  toJSON() {
    return { repos: this.repos.map((r) => r.toJSON()) };
  }
}

/** 러너가 연 PR 하나 (콘솔, 결재 화면). 저장소 이름까지 */
export class PullView {
  constructor(
    private readonly row: Readonly<PullRow>,
    private readonly repoName: string,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      repoId: r.repo_id,
      repoName: this.repoName,
      taskId: r.task_id,
      number: r.number,
      url: r.url,
      branch: r.branch,
      headSha: r.head_sha,
      checks: r.checks as { command: string; ok: boolean }[],
      status: r.status,
      version: r.version,
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** PR 목록 (콘솔) */
export class PullListView {
  constructor(private readonly pulls: readonly PullView[]) {}

  toJSON() {
    return { pulls: this.pulls.map((p) => p.toJSON()) };
  }
}

/** 일을 맡긴 뒤 (콘솔). 작업은 코어가 이벤트를 받아 만든다 */
export class AskedView {
  constructor(private readonly requestId: string) {}

  toJSON() {
    return { requestId: this.requestId };
  }
}

/** code_credential의 답 (러너에게만). 토큰은 러너의 메모리에만 둔다 */
export class CredentialView {
  constructor(
    private readonly token: string,
    private readonly apiUrl: string,
    /** "고쳐 달라"로 다시 온 일이면 이미 연 PR */
    private readonly pull: Readonly<PullRow> | null,
  ) {}

  toJSON() {
    return {
      token: this.token,
      api_url: this.apiUrl,
      pull: this.pull ? { number: this.pull.number, branch: this.pull.branch } : null,
    };
  }
}

/** code_pull_opened의 답 (러너에게). 이 판으로 결재를 올린다 */
export class PullOpenedView {
  constructor(private readonly row: Readonly<PullRow>) {}

  toJSON() {
    return { pull_id: this.row.id, version: this.row.version };
  }
}

/** 결재 이벤트를 받은 뒤 (코어가 버린다) */
export class ConfirmedView {
  constructor(private readonly handled: boolean) {}

  toJSON() {
    return { handled: this.handled };
  }
}

/** code_repos의 답 (MCP라 snake_case): 코드 작업을 요청할 수 있는 저장소. 명령(setup · checks)은 싣지 않는다 */
export class AgentRepoListView {
  constructor(private readonly rows: readonly RepoRow[]) {}

  toJSON() {
    return {
      repos: this.rows.map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        base: r.base,
      })),
    };
  }
}

/** code_ask_task의 답 (MCP): 이 id · version으로 request_approval(code.task.start, 대상 code_github_ask)을 올린다 */
export class TaskAskedView {
  constructor(private readonly row: Readonly<TaskAskRow>) {}

  toJSON() {
    return { ask_id: this.row.id, version: this.row.version, status: this.row.status };
  }
}

/** 코드 작업 요청 하나 (콘솔: 승인 화면 · 결과 카드가 저장소 · 경로 · 지시를 보인다) */
export class TaskAskView {
  constructor(
    private readonly row: Readonly<TaskAskRow>,
    private readonly repo: Readonly<RepoRow>,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      repo: { id: this.repo.id, name: this.repo.name, url: this.repo.url, base: this.repo.base },
      paths: r.paths,
      instruction: r.instruction,
      agentId: r.agent_id,
      askedBy: r.asked_by,
      status: r.status,
      version: r.version,
      createdAt: r.created_at.toISOString(),
    };
  }
}
