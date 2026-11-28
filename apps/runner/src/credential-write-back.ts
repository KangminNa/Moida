import type { AiTool } from './ai-tool';
import type { JobWorkspace } from './job-workspace';
import type { MoidaServer } from './moida-server';
import type { RunLog } from './redactor';

/**
 * 실행하는 동안 CLI가 갱신한 자격(Codex auth.json)을 서버에 되돌려 쓴다. 끝내는 길(성공 · 실패 · 취소)과 상관없이:
 * 버리면 다음 실행이 이미 쓴 갱신 토큰을 내밀어 로그인이 깨진다. 이 컴퓨터의 로그인(판 없음)은 서버에 쓰지 않는다.
 * 판이 다르면(주인이 그사이 다시 로그인) 서버가 거절하고 새 로그인이 이긴다. AI를 두 번 띄우면 두 번 쓴다 (JobRun에서 옮김)
 */
export class CredentialWriteBack {
  /** 마지막으로 되돌려 쓴 자격 */
  private written: string | null = null;

  constructor(
    private readonly server: MoidaServer,
    private readonly taskId: string,
    private readonly log: RunLog,
    /** 서버에 있는 로그인의 판. 되돌려 쓸 때마다 새 판이 된다 */
    private version: number | null,
  ) {}

  async write(
    tool: AiTool,
    workspace: JobWorkspace,
    persist: <T>(send: () => Promise<T>) => Promise<T>,
  ): Promise<void> {
    const version = this.version;
    if (version === null) return;
    const credential = await tool.changedCredential(workspace);
    if (credential === null || credential === this.written) return;
    try {
      this.version = await persist(() =>
        this.server.aiLoginRefresh(this.taskId, tool.id, version, credential),
      );
      this.written = credential;
      this.log.info(`${this.taskId}: 갱신된 ${tool.id} 로그인을 서버에 저장했어요`);
    } catch (error) {
      this.log.info(
        `${this.taskId}: 갱신된 로그인을 저장하지 못했어요: ${(error as Error).message}`,
      );
    }
  }
}
