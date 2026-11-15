import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserPages } from './browser-page';
import type { CairnServer } from './cairn-server';
import { ServerUnreachable, ToolRefused } from './mcp-client';
import { RunEvent } from './progress';

/**
 * 브라우저 작업에서 AI가 단계마다 찍은 화면을 찍은 순서대로 올린다 (browser_shot_save). 300KB가 넘는 화면은 건너뛰고,
 * 서버가 더 받지 않으면(작업마다 30장) 멈춘다. BrowseStage에서 나눴다 (2026-11-16)
 */
export class StepShots {
  private static readonly FILE = /\.(jpe?g|png)$/i;

  constructor(
    private readonly server: Pick<CairnServer, 'saveShot'>,
    private readonly taskId: string,
  ) {}

  async ship(dir: string, signal: AbortSignal, note: (event: RunEvent) => void): Promise<void> {
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) =>
      StepShots.FILE.test(n),
    );
    const files = await Promise.all(
      names.map(async (name) => ({ name, info: await stat(join(dir, name)) })),
    );
    files.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs);
    let sent = 0;
    for (const { name, info } of files) {
      if (signal.aborted) return;
      if (info.size > BrowserPages.SHOT_MAX) {
        note(new RunEvent(RunEvent.ERROR, `단계 화면이 300KB를 넘어 올리지 않았어요: ${name}`, 0));
        continue;
      }
      try {
        const image = (await readFile(join(dir, name))).toString('base64');
        await this.server.saveShot(this.taskId, { url: '', title: name, image });
        sent++;
      } catch (error) {
        if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) throw error;
        note(new RunEvent(RunEvent.ERROR, `단계 화면을 더 올리지 못했어요: ${error.message}`, 0));
        break;
      }
    }
    if (sent > 0) note(new RunEvent(RunEvent.WRITE, `단계 화면 ${sent}장을 남겼어요`, 0));
  }
}
