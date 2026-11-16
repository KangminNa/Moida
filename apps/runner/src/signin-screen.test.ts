import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SigninScreen } from './signin-screen';

// 터미널 화면을 글로: 색 · 하이퍼링크는 지우고, 같은 줄 안의 이동은 빈칸, 그 밖의 커서 이동은 줄바꿈.
// 엔진마다 무엇을 꺼내는지는 claude-signin.test · codex-signin.test.

const ESC = '\x1b';

test('색 · 하이퍼링크를 지우고, 칸 이동은 빈칸, 다시 그리기는 줄바꿈이다', () => {
  const screen = new SigninScreen();
  screen.add(`${ESC}[36mHello${ESC}[39m${ESC}[8Gworld\r\n`);
  screen.add(`${ESC}]8;;https://x.test\x07https://x.test${ESC}]8;;\x07${ESC}[2K${ESC}[1Anext`);
  assert.equal(screen.text, 'Hello world\nhttps://x.test\n\nnext');
});

test('화면은 끝의 256KB만 둔다', () => {
  const screen = new SigninScreen();
  screen.add('a'.repeat(300 * 1024));
  screen.add('끝');
  assert.equal(screen.text.length, 256 * 1024);
  assert.ok(screen.text.endsWith('끝'));
});
