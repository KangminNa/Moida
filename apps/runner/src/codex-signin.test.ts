import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { CodexSignin } from './codex-signin';
import { SigninScreen } from './signin-screen';

// codex login --device-auth의 화면에서 주소 · 한 번 쓰는 코드만 꺼내고, 잘 끝나면 auth.json을 자격으로 읽는다.

const ESC = '\x1b';
const color = (text: string) => `${ESC}[36m${text}${ESC}[39m`;
const signin = new CodexSignin();

/** 쌓인 화면을 CodexSignin으로 읽는다 */
class Shown {
  private readonly screen = new SigninScreen();

  add(chunk: string): void {
    this.screen.add(chunk);
  }

  get url(): string | null {
    return signin.read(this.screen.text)?.url ?? null;
  }

  get userCode(): string | null {
    return signin.read(this.screen.text)?.userCode ?? null;
  }
}

function screenOf(...chunks: string[]): Shown {
  const screen = new Shown();
  for (const chunk of chunks) screen.add(chunk);
  return screen;
}

describe('codex login --device-auth', () => {
  const lines = [
    'Welcome to Codex [v0.164.0]\r\n',
    'Follow these steps to sign in with ChatGPT using device code authorization:\r\n\r\n',
    `1. Open this link in your browser and sign in to your account\r\n   ${color('https://auth.openai.com/codex/device')}\r\n\r\n`,
    '2. Enter this one-time code (expires in 15 minutes)\r\n',
    `   ${color('ABCD-1E2F3')}\r\n\r\n`,
    'Device codes are a common phishing target. Never share this code.\r\n',
  ];

  test('주소와 "one-time code" 다음의 코드를 꺼낸다', () => {
    const screen = screenOf(...lines);
    assert.equal(screen.url, 'https://auth.openai.com/codex/device');
    assert.equal(screen.userCode, 'ABCD-1E2F3');
  });

  test('코드가 오기 전에는 주소도 알리지 않는다', () => {
    const screen = screenOf(...lines.slice(0, 4));
    assert.equal(screen.userCode, null);
    assert.equal(screen.url, null);
  });

  test('코드가 같은 줄에 있어도 꺼낸다', () => {
    const screen = screenOf(
      'https://auth.openai.com/codex/device\n',
      'Enter this one-time code: WXYZ-98765\n',
    );
    assert.equal(screen.userCode, 'WXYZ-98765');
  });

  test('쿼리가 붙은 주소는 꺼내지 않는다', () => {
    const screen = screenOf(
      'https://auth.openai.com/codex/device?x=1\n',
      'one-time code\nABCD-12345\n',
    );
    assert.equal(screen.url, null);
  });
});

describe('codex 로그인의 나머지', () => {
  test('auth.json으로 남기게 설정하고, 잘 끝났을 때만 auth.json을 자격으로 읽는다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-signin-'));
    try {
      await signin.prepare(dir);
      assert.match(
        await readFile(join(dir, 'config.toml'), 'utf8'),
        /cli_auth_credentials_store = "file"/,
      );
      assert.deepEqual(signin.env(dir), { CODEX_HOME: dir });
      assert.equal(await signin.credential('', dir, true), null, 'auth.json이 아직 없다');
      await writeFile(join(dir, 'auth.json'), '{"tokens":{}}');
      assert.equal(await signin.credential('', dir, false), null);
      assert.equal(await signin.credential('', dir, true), '{"tokens":{}}');
      assert.equal(
        signin.failure({ code: 0, signal: null, spawnError: null }),
        'Codex가 auth.json을 남기지 않았어요',
      );
      assert.equal(signin.failure({ code: 1, signal: null, spawnError: null }), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
