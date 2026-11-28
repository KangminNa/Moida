import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DeviceKind, type DeviceLogin } from './device-login';
import { FolderZip } from './folder-zip';
import { MoidaHome } from './moida-home';
import { MoidaSite, SiteAddress } from './moida-site';
import type { Shell } from './shell';
import { CliError, type Terminal } from './terminal';

// moida app deploy <앱 주소> <폴더> [--site <블로그 주소>] [--note <메모>] (앱 플랫폼, docs/스토어.md 12.5):
// 이 컴퓨터에서 빌드한 폴더를 앱 코드의 새 버전으로 올린다. 처음에는 브라우저로 배포 기기(쓰기만)를 승인받고
// 그 열쇠를 ~/.moida/credentials.json의 deploy에 둔다. 다음부터는 --site 없이 그 블로그로 올린다.
// 올리기는 ~/.moida/bin/moida-deploy.mjs가 한다 (토큰 갱신을 훅 · 상태 줄과 같은 잠금으로 하게).
// 공개 앱의 새 버전은 확인 대기라 관리자가 콘솔에서 공개해야 보인다 (원칙 7).
export class DeployCommand {
  private static readonly SCRIPT = 'moida-deploy.mjs';
  private static readonly KIND = DeviceKind.DEPLOY;
  private readonly home: MoidaHome;

  constructor(
    private readonly terminal: Terminal,
    private readonly shell: Shell,
    private readonly login: DeviceLogin,
    moidaDir = join(homedir(), '.moida'),
  ) {
    this.home = new MoidaHome(moidaDir);
  }

  async run(app: string, folder: string, site: string | null, note: string | null): Promise<void> {
    const t = this.terminal;
    const dir = resolve(folder);
    if (!existsSync(dir) || !statSync(dir).isDirectory())
      throw new CliError(`폴더가 아니에요: ${folder}`);
    if (!existsSync(join(dir, 'index.html')))
      throw new CliError(`${folder}에 index.html이 없어요 (빌드 결과 폴더를 넣어 주세요)`);
    const at = await this.address(site);
    this.home.installScripts();
    await this.ensureDevice(at);

    const zip = FolderZip.pack(dir);
    if (zip.skipped.length > 0) t.say(`  넣지 않음: ${zip.skipped.join(' · ')}`);
    const temp = mkdtempSync(join(tmpdir(), 'moida-deploy-'));
    try {
      const file = join(temp, 'app.zip');
      writeFileSync(file, zip.bytes, { mode: 0o600 });
      let result = await this.upload(app, file, note);
      if (result.disconnected) {
        // 기기가 끊겼다 (콘솔에서 지웠거나 갱신 토큰이 죽음): 다시 승인받고 한 번 더
        await this.createDevice(at);
        result = await this.upload(app, file, note);
      }
      if (result.disconnected) throw new CliError('배포 기기가 끊겼어요. 다시 실행해 주세요');
      if (result.failed) throw new CliError(`올리지 못했어요: ${result.failed}`);
      if (result.refused) throw new CliError(`블로그가 받지 않았어요: ${result.refused.message}`);
      const state = result.state ?? {};
      const size = Math.max(1, Math.round(zip.bytes.length / 1024));
      t.done(`${app} 버전 ${String(state.latest)} · 파일 ${zip.names.length}개 · ${size}KB`);
      if (state.pending === null) t.say(`  바로 보여요: ${at.site}/${app}`);
      else t.say(`  공개 앱이라 확인 대기예요. 콘솔 › 스토어 › ${app} › 코드에서 공개해요`);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }

  /** 올릴 블로그: --site가 있으면 그 블로그에 물어, 없으면 지난번에 배포한 블로그 */
  private async address(site: string | null): Promise<SiteAddress> {
    if (site !== null) return MoidaSite.parse(site).address();
    const saved = this.saved();
    if (saved && typeof saved.site === 'string' && typeof saved.mcp === 'string')
      return new SiteAddress(saved.site, saved.mcp);
    throw new CliError('처음에는 --site <블로그 주소>로 올릴 블로그를 알려 주세요');
  }

  private saved(): Record<string, unknown> | undefined {
    return this.home.credentials()[DeployCommand.KIND.scope] as Record<string, unknown> | undefined;
  }

  /** 이 블로그의 배포 기기가 없거나 끊겼으면 브라우저로 승인받는다 */
  private async ensureDevice(at: SiteAddress): Promise<void> {
    const saved = this.saved();
    if (saved?.site === at.site && !saved.dead) return;
    await this.createDevice(at);
  }

  private async createDevice(at: SiteAddress): Promise<void> {
    const kind = DeployCommand.KIND;
    if (!this.terminal.interactive)
      throw new CliError(
        `${kind.label}가 없어요. 직접 입력할 수 있는 터미널에서 한 번 실행해 브라우저로 승인해 주세요`,
      );
    const name = `${hostname().split('.')[0] || '내 컴퓨터'} · ${kind.suffix}`;
    const credential = await this.login.run(at, name, kind);
    this.home.saveCredential(kind.scope, credential.toJSON());
    this.terminal.done(`${kind.label} ${name} (${kind.permission})`);
  }

  /** 올리기 스크립트를 돌려 그 답(JSON 한 줄)을 읽는다 */
  private async upload(app: string, file: string, note: string | null): Promise<DeployResult> {
    const ran = await this.shell.run(process.execPath, [
      this.home.script(DeployCommand.SCRIPT),
      app,
      file,
      ...(note ? [note] : []),
    ]);
    try {
      return JSON.parse(ran.stdout.trim().split('\n').pop() ?? '') as DeployResult;
    } catch {
      return { failed: ran.output || `올리기 스크립트가 ${ran.code}로 끝났어요` };
    }
  }
}

/** moida-deploy.mjs가 찍는 답 */
interface DeployResult {
  state?: { current?: unknown; pending?: unknown; latest?: unknown };
  refused?: { code: string; message: string };
  disconnected?: boolean;
  failed?: string;
}
