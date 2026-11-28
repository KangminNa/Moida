import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeStream } from './claude-stream';

// 세션 키마다 고정 자리 (CLI 세션 재개, 기획서 결정 2026-11-17). Claude Code는 세션 파일을 설정 폴더의
// projects/<작업 폴더>/<세션 id>.jsonl에 남기고, 재개(--resume)는 같은 설정 폴더 · 같은 작업 폴더에서만 찾는다.
// 그래서 세션 키마다 폴더 하나를 두고 실행마다 그 자리를 다시 쓴다:
//   config/projects/  CLI의 세션 파일 (남긴다)
//   meta.json         앞 실행이 남긴 CLI 세션과 잘 끝났는지 { cliSession, endedOk, at, tools }
//   lock              지금 쓰는 실행의 pid. 같은 세션 키의 일이 동시에 돌면 뒤의 것은 임시 자리에서 새로 시작한다
//   그 밖(work · home · mcp.json · 설정 파일)은 실행마다 지운다
// 24시간이 지났거나 50개를 넘으면 오래된 것부터 지운다: 세션 파일에는 도구의 결과까지 들어 있어 오래 두지 않는다.
// 세션 파일을 남기는 일만 쓴다 (서버의 run.keep: 브라우저 · 샌드박스 일은 아니다)
// 기본 자리는 공유될 수 있는 임시 폴더 아래라(RunnerConfig) 쓰기 전에 이 사용자의 폴더인지 본다:
// 링크거나 다른 사용자의 것이면 쓰지 않는다(이 실행은 임시 자리에서 새로 시작한다), 내 것이면 700으로 좁힌다
export class LineageStore {
  static readonly KEEP_MS = 24 * 60 * 60_000;
  static readonly MAX = 50;

  constructor(private readonly dir: string) {}

  /** 세션 키의 자리를 잡는다. 다른 실행이 쓰는 중이면 null (그 실행은 임시 자리에서 새로 시작한다) */
  async claim(lineage: string, now = new Date()): Promise<LineagePlace | null> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.assertMine();
    await this.sweep(now);
    const name = createHash('sha256').update(lineage).digest('hex').slice(0, 32);
    const place = new LineagePlace(join(this.dir, name));
    await mkdir(place.root, { recursive: true, mode: 0o700 });
    return (await place.lock()) ? place : null;
  }

  /** 세션 키 폴더가 이 사용자의 진짜 폴더인지 (링크 아님 · 내 것). 아니면 Error, 내 것이면 다른 사용자의 권한을 뺀다 */
  private async assertMine(): Promise<void> {
    const info = await lstat(this.dir);
    if (!info.isDirectory()) throw new Error(`세션 키 폴더가 폴더가 아니에요 (링크): ${this.dir}`);
    if (process.getuid && info.uid !== process.getuid())
      throw new Error(`다른 사용자의 세션 키 폴더예요: ${this.dir}`);
    if ((info.mode & 0o077) !== 0) await chmod(this.dir, 0o700);
  }

  /** 24시간 지났거나 50개를 넘는 자리를 오래된 것부터 지운다. 쓰는 중인 자리는 두고 */
  async sweep(now = new Date()): Promise<void> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const places = await Promise.all(
      names.map(async (name) => {
        const place = new LineagePlace(join(this.dir, name));
        return [place, await place.touchedAt()] as const;
      }),
    );
    places.sort((a, b) => b[1] - a[1]);
    for (const [i, [place, at]] of places.entries()) {
      const old = now.getTime() - at > LineageStore.KEEP_MS || i >= LineageStore.MAX;
      if (old && !(await place.busy())) await rm(place.root, { recursive: true, force: true });
    }
  }
}

/** 세션 키 하나의 자리 */
export class LineagePlace {
  private static readonly META = 'meta.json';
  private static readonly LOCK = 'lock';
  private static readonly CONFIG = 'config';
  private static readonly PROJECTS = 'projects';
  /**
   * 세션 파일이 부른 도구의 이름공간 (MCP 서버 이름). 다르면 재개하지 않는다 (2026-11-28): 이름을 cairn → moida로 바꾼 뒤
   * 재개한 대화가 앞 기록대로 mcp__cairn__delegate_task를 불러 "없는 도구"로 거듭 거절돼 대표가 일을 맡기지 못했다
   */
  static readonly TOOLS = ClaudeStream.SERVER;
  /** CLI가 알린 세션 id의 모양 (파일 이름으로 쓴다) */
  private static readonly SESSION_ID = /^[A-Za-z0-9-]{1,120}$/;

  constructor(readonly root: string) {}

  /** 비어 있으면 잡는다. 살아 있는 다른 실행이 쥐었으면 false. 끝난 프로세스의 것은 거둔다 */
  async lock(): Promise<boolean> {
    const path = join(this.root, LineagePlace.LOCK);
    for (let tries = 0; tries < 2; tries++) {
      try {
        await writeFile(path, String(process.pid), { flag: 'wx', mode: 0o600 });
        return true;
      } catch {
        if (await this.busy()) return false;
        await rm(path, { force: true });
      }
    }
    return false;
  }

  async release(): Promise<void> {
    await rm(join(this.root, LineagePlace.LOCK), { force: true });
  }

  /** 살아 있는 프로세스가 쥐고 있는가 */
  async busy(): Promise<boolean> {
    const pid = Number(await readFile(join(this.root, LineagePlace.LOCK), 'utf8').catch(() => ''));
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  /**
   * 재개할 CLI 세션: 서버의 후보(같은 러너 · 같은 에이전트 설정)와 앞 실행이 남긴 것이 같고, 앞 실행이 잘 끝났고, 도구 이름공간이 같고,
   * 24시간 안이고, 세션 파일이 남아 있을 때만 그 id. 아니면 null (새로 시작한다)
   */
  async resumable(candidate: string | null, now = new Date()): Promise<string | null> {
    if (candidate === null || !LineagePlace.SESSION_ID.test(candidate)) return null;
    const meta = await this.meta();
    if (meta?.cliSession !== candidate || meta.endedOk !== true) return null;
    if (meta.tools !== LineagePlace.TOOLS) return null;
    if (now.getTime() - Date.parse(String(meta.at)) > LineageStore.KEEP_MS) return null;
    const projects = join(this.root, LineagePlace.CONFIG, LineagePlace.PROJECTS);
    const dirs = await readdir(projects).catch(() => [] as string[]);
    return dirs.some((dir) => existsSync(join(projects, dir, `${candidate}.jsonl`)))
      ? candidate
      : null;
  }

  /** 이번 실행이 남긴 CLI 세션과 잘 끝났는지 (다음 실행이 재개할지 본다). 세션을 모르면 지운다 */
  async remember(cliSession: string | null, endedOk: boolean, now = new Date()): Promise<void> {
    const path = join(this.root, LineagePlace.META);
    if (cliSession === null || !LineagePlace.SESSION_ID.test(cliSession))
      return rm(path, { force: true });
    const meta = { cliSession, endedOk, at: now.toISOString(), tools: LineagePlace.TOOLS };
    await writeFile(path, JSON.stringify(meta), { mode: 0o600 });
  }

  /** 실행 앞뒤로: 세션 파일(config/projects) · meta.json · lock만 두고 지운다 (작업 토큰 · 작업 폴더가 남지 않게) */
  async clear(): Promise<void> {
    const kept = [LineagePlace.CONFIG, LineagePlace.META, LineagePlace.LOCK];
    for (const name of await readdir(this.root).catch(() => [] as string[]))
      if (!kept.includes(name)) await rm(join(this.root, name), { recursive: true, force: true });
    const config = join(this.root, LineagePlace.CONFIG);
    for (const name of await readdir(config).catch(() => [] as string[]))
      if (name !== LineagePlace.PROJECTS)
        await rm(join(config, name), { recursive: true, force: true });
  }

  /** 마지막으로 쓴 때 (meta.json, 없으면 폴더) */
  async touchedAt(): Promise<number> {
    const meta = await stat(join(this.root, LineagePlace.META)).catch(() => null);
    return meta?.mtimeMs ?? (await stat(this.root).catch(() => null))?.mtimeMs ?? 0;
  }

  private async meta(): Promise<Record<string, unknown> | null> {
    try {
      const value = JSON.parse(await readFile(join(this.root, LineagePlace.META), 'utf8'));
      return typeof value === 'object' && value !== null ? value : null;
    } catch {
      return null;
    }
  }
}
