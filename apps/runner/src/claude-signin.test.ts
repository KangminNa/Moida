import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ClaudeSignin } from './claude-signin';
import { SigninScreen } from './signin-screen';

// claude setup-token의 화면에서 주소 · 토큰만 꺼낸다. 화면은 Ink가 색과 커서 이동으로 다시 그리므로 그 모양을 섞어 본다.

const ESC = '\x1b';
const URL_CLAUDE =
  'https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=abc_DEF-123&code_challenge_method=S256&state=xyz';
const TOKEN = `sk-ant-oat01-${'A1b2_C3d4-'.repeat(10)}`;
/** 색, 지우기, 커서 올리기, 하이퍼링크(OSC 8) */
const color = (text: string) => `${ESC}[36m${text}${ESC}[39m`;
const link = (url: string) => `${ESC}]8;;${url}\x07${url}${ESC}]8;;\x07`;
const redraw = `${ESC}[2K${ESC}[1A${ESC}[2K${ESC}[G`;
const signin = new ClaudeSignin();

/** 쌓인 화면을 ClaudeSignin으로 읽는다 */
class Shown {
  private readonly screen = new SigninScreen();

  add(chunk: string): void {
    this.screen.add(chunk);
  }

  get text(): string {
    return this.screen.text;
  }

  get url(): string | null {
    return signin.read(this.text)?.url ?? null;
  }

  get userCode(): string | null {
    return signin.read(this.text)?.userCode ?? null;
  }

  token(ended: boolean): string | null {
    return ClaudeSignin.token(this.text, ended);
  }
}

function screenOf(...chunks: string[]): Shown {
  const screen = new Shown();
  for (const chunk of chunks) screen.add(chunk);
  return screen;
}

describe('claude setup-token', () => {
  const opening = [
    `${color('Browser didn’t open? Use the url below to sign in (c to copy)')}\r\n\r\n`,
    `${link(URL_CLAUDE)}\r\n\r\n`,
    `Paste code here if prompted > `,
  ];

  test('색과 하이퍼링크를 걷어 낸 주소를 꺼낸다. 코드는 없다', () => {
    const screen = screenOf(...opening);
    assert.equal(screen.url, URL_CLAUDE);
    assert.equal(screen.userCode, null);
  });

  test('실제 화면 모양 (claude 2.1.318): 낱말 사이를 칸 이동(G)으로 띄우고, 주소는 id가 붙은 하이퍼링크', () => {
    const words = (col: number, ...list: string[]) =>
      list.map((w, i) => `${ESC}[${col + i * 6}G${w}`).join('');
    const screen = screenOf(
      `${ESC}[?1004h${ESC}[38;5;174mWelcome${ESC}[9Gto${ESC}[12GClaude${ESC}[19GCode${ESC}[39m\r\r\n`,
      `${words(2, 'Browser', "didn't", 'open?', 'Use', 'the', 'url', 'below')}\r\r\n\r\r\n`,
      `${ESC}]8;id=nz8nva;${URL_CLAUDE}\x07${ESC}[38;5;246m${URL_CLAUDE}${ESC}[39m${ESC}]8;;\x07\r\r\n\r\r\n`,
      `${ESC}[2GPaste${ESC}[8Gcode${ESC}[13Ghere${ESC}[18Gif${ESC}[21Gprompted${ESC}[30G>\r\r\n`,
      `${ESC}[>0q${ESC}[?u${ESC}]7501;?\x07${ESC}[c`,
    );
    assert.equal(screen.url, URL_CLAUDE);
    assert.match(screen.text, /Welcome to Claude Code/);
    assert.match(screen.text, /Paste code here if prompted >/);
    screen.add(
      `${words(2, 'Your', 'OAuth', 'token', '(valid', 'for', '1', 'year):')}\r\r\n\r\r\n${ESC}[2G${TOKEN}\r\r\n\r\r\n`,
    );
    screen.add(`${words(2, 'Store', 'this', 'token', 'securely.')}\r\r\n`);
    assert.equal(screen.token(false), TOKEN);
  });

  test('주소가 아직 다 오지 않았으면 기다린다', () => {
    const half = URL_CLAUDE.slice(0, 80);
    const screen = screenOf(opening[0] as string, half);
    assert.equal(screen.url, null);
    screen.add(`${URL_CLAUDE.slice(80)}\r\n`);
    assert.equal(screen.url, URL_CLAUDE);
  });

  test('다시 그린 화면이 주소 뒤에 붙지 않는다', () => {
    const screen = screenOf(URL_CLAUDE, redraw, 'Paste code here if prompted >');
    assert.equal(screen.url, URL_CLAUDE);
  });

  test('모르는 출처의 주소는 꺼내지 않는다', () => {
    const fake = 'https://claude.ai.evil.example/oauth/authorize?code=true&state=s ';
    assert.equal(screenOf(fake, '\n').url, null);
  });

  test('토큰은 두 표시 사이의 마지막 것. 붙여 넣은 코드의 메아리는 토큰이 아니다', () => {
    const screen = screenOf(
      ...opening,
      'pasted-code#state\r\n',
      `${color('✓ Long-lived authentication token created successfully!')}\r\n\r\n`,
      'Your OAuth token (valid for 1 year):\r\n\r\n',
      `${TOKEN.slice(0, 50)}`,
    );
    assert.equal(screen.token(false), null, '끝 표시 전에는 다 온 것인지 모른다');
    screen.add(`${TOKEN.slice(50)}\r\n${redraw}${TOKEN}\r\n\r\n`);
    screen.add("Store this token securely. You won't be able to see it again.\r\n");
    assert.equal(screen.token(false), TOKEN);
  });

  test('끝 표시 없이 명령이 끝났으면 앞 표시 뒤에서 찾는다', () => {
    const screen = screenOf('Your OAuth token (valid for 1 year):\r\n', `${TOKEN}\r\n`);
    assert.equal(screen.token(false), null);
    assert.equal(screen.token(true), TOKEN);
  });

  test('표시 문구가 바뀌어도 잘 끝났으면 화면의 마지막 토큰을 쓴다. 끝나기 전에는 꺼내지 않는다', () => {
    const screen = screenOf(
      'Paste code here if prompted > pasted-code#state\r\n',
      `Here is your long-lived token:\r\n${TOKEN}\r\n`,
    );
    assert.equal(screen.token(false), null, '다 왔는지 모른다');
    assert.equal(screen.token(true), TOKEN);
    assert.equal(screenOf('pasted-code#state\r\n').token(true), null);
  });
});

describe('claude 로그인의 나머지', () => {
  test('명령 · 설정 폴더 · 자격 · 실패 문구', async () => {
    assert.deepEqual(signin.args, ['setup-token']);
    assert.deepEqual(signin.env('/c'), { CLAUDE_CONFIG_DIR: '/c' });
    const done = `Your OAuth token (valid for 1 year):\n${TOKEN}\n`;
    assert.equal(await signin.credential(done, '/없는', true), TOKEN);
    assert.equal(await signin.credential(done, '/없는', false), null);
    assert.match(
      signin.failure({ code: 1, signal: null, spawnError: null }, true, '코드 1') ?? '',
      /코드가 맞지 않거나/,
    );
    assert.equal(
      signin.failure({ code: 1, signal: null, spawnError: null }, false, '코드 1'),
      null,
    );
  });
});
