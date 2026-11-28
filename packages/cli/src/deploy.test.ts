import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { DeployCommand } from './deploy.command';
import { DeviceLogin } from './device-login';
import { FolderZip } from './folder-zip';
import { Shell } from './shell';
import { CliError, Terminal } from './terminal';
import { FakeMoida } from './testing/fake-moida';

// moida app deploy: 빌드한 폴더를 zip으로 묶어, 배포 기기(OAuth scope=deploy → 권한 write만)로 표를 받아 올린다.
// 블로그는 테스트용 서버(FakeMoida), 브라우저는 fetch로 대신한다. 올리기 스크립트(~/.moida/bin/moida-deploy.mjs)는 실제로 돈다.

/** 브라우저 대신: 승인 주소를 열면 테스트용 블로그가 곧바로 이 컴퓨터의 주소로 돌려보낸다 */
class FakeBrowser extends Shell {
  readonly opened: string[] = [];

  override async openBrowser(url: string): Promise<void> {
    this.opened.push(url);
    void fetch(url).catch(() => {});
  }
}

class FakeTerminal extends Terminal {
  readonly lines: string[] = [];
  tty = true;

  override get interactive(): boolean {
    return this.tty;
  }

  override say(line = ''): void {
    this.lines.push(line);
  }
}

/** zip을 풀어 이름 → 내용 (FolderZip이 만든 것: 저장 순서대로, deflate) */
function unzip(bytes: Buffer): Record<string, string> {
  const files: Record<string, string> = {};
  let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    const packed = bytes.readUInt32LE(at + 18);
    const nameLength = bytes.readUInt16LE(at + 26);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength;
    files[name] = inflateRawSync(bytes.subarray(start, start + packed)).toString('utf8');
    at = start + packed;
  }
  return files;
}

let blog: FakeMoida;
let dir: string;
let home: string | undefined;
let terminal: FakeTerminal;
let browser: FakeBrowser;

const moidaDir = () => join(dir, '.moida');
const credentials = () => JSON.parse(readFileSync(join(moidaDir(), 'credentials.json'), 'utf8'));
const command = () =>
  new DeployCommand(terminal, browser, new DeviceLogin(terminal, browser, 5_000), moidaDir());
/** 빌드 결과 폴더 하나 */
function build(files: Record<string, string>): string {
  const root = join(dir, 'dist');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

before(async () => {
  blog = new FakeMoida();
  await blog.start();
});
after(() => blog.close());
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'moida-deploy-test-'));
  // 올리기 스크립트는 ~/.moida을 읽는다: 이 테스트의 폴더를 집으로
  home = process.env.HOME;
  process.env.HOME = dir;
  terminal = new FakeTerminal();
  browser = new FakeBrowser();
  blog.calls.length = 0;
  blog.deployed.length = 0;
  blog.asked.length = 0;
  blog.deployAnswer = { status: 200, body: { current: 1, pending: null, latest: 1 } };
});
afterEach(() => {
  process.env.HOME = home;
  rmSync(dir, { recursive: true, force: true });
});

describe('FolderZip', () => {
  test('폴더를 이름순으로 묶고 숨김 파일 · node_modules · 링크는 넣지 않는다', () => {
    const root = build({
      'index.html': '<html>앱</html>',
      'assets/app.js': 'console.log("한글")',
      '.env': 'SECRET=1',
      'node_modules/x/index.js': 'x',
    });
    symlinkSync(join(root, 'index.html'), join(root, 'link.html'));
    const zip = FolderZip.pack(root);
    assert.deepEqual(zip.names, ['assets/app.js', 'index.html']);
    assert.deepEqual([...zip.skipped].sort(), ['.env', 'link.html', 'node_modules']);
    assert.deepEqual(unzip(zip.bytes), {
      'assets/app.js': 'console.log("한글")',
      'index.html': '<html>앱</html>',
    });
    assert.ok(FolderZip.pack(root).bytes.equals(zip.bytes), '같은 폴더는 같은 zip');
  });
});

describe('moida app deploy', () => {
  test('처음에는 배포 기기를 승인받고, 표를 받아 묶음을 올린다', async () => {
    const root = build({ 'index.html': '<html>앱</html>', 'assets/app.js': 'a' });
    await command().run('lingo', root, blog.origin, '첫 배포');

    assert.deepEqual(blog.asked, ['deploy']);
    assert.equal(credentials().deploy.site, blog.origin);
    const [call] = blog.calls;
    assert.equal(call?.tool, 'app_code_upload');
    const [sent] = blog.deployed;
    assert.equal(sent?.path, '/api/apps/lingo/code/versions');
    assert.deepEqual(call?.args, {
      app: 'lingo',
      size: sent?.bytes.length,
      sha256: createHash('sha256')
        .update(sent?.bytes ?? Buffer.alloc(0))
        .digest('hex'),
      note: '첫 배포',
    });
    assert.deepEqual(Object.keys(unzip(sent?.bytes ?? Buffer.alloc(0))), [
      'assets/app.js',
      'index.html',
    ]);
    const out = terminal.lines.join('\n');
    assert.match(out, /lingo 버전 1 · 파일 2개/);
    assert.match(out, /바로 보여요/);
    assert.doesNotMatch(out, /moida_at_|moida_rt_|deploy-ticket/, '토큰 · 표를 찍지 않는다');
  });

  test('다음부터는 --site 없이 같은 블로그로, 다시 승인받지 않는다. 공개 앱은 확인 대기를 알린다', async () => {
    const root = build({ 'index.html': '<html>앱</html>' });
    await command().run('lingo', root, blog.origin, null);
    blog.asked.length = 0;
    blog.deployAnswer = { status: 200, body: { current: 1, pending: 2, latest: 2 } };
    terminal.tty = false;
    await command().run('lingo', root, null, null);
    assert.deepEqual(blog.asked, [], '기기를 다시 만들지 않는다');
    assert.equal(blog.deployed.length, 2);
    assert.match(terminal.lines.join('\n'), /확인 대기/);
  });

  test('올릴 수 없으면 까닭을 알린다: 폴더 · index.html · 블로그 · 터미널 · 서버의 거절', async () => {
    const fails = async (run: Promise<void>, pattern: RegExp) =>
      assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof CliError, String(error));
        assert.match(error.message, pattern);
        return true;
      });
    await fails(command().run('lingo', join(dir, 'none'), blog.origin, null), /폴더가 아니에요/);
    const empty = build({ 'app.js': 'a' });
    await fails(command().run('lingo', empty, blog.origin, null), /index\.html이 없어요/);
    const root = build({ 'index.html': '<html>앱</html>' });
    await fails(command().run('lingo', root, null, null), /--site/);
    terminal.tty = false;
    await fails(command().run('lingo', root, blog.origin, null), /직접 입력할 수 있는 터미널/);
    terminal.tty = true;
    blog.deployAnswer = { status: 422, body: { code: 'rule', message: '첫 화면이 없어요' } };
    await fails(command().run('lingo', root, blog.origin, null), /받지 않았어요: 첫 화면이 없어요/);
  });
});
