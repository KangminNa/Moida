import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appsPathKind, isAppsMemberScreen, movesToApps } from './apps-paths.ts';

test('공통 앱 도메인: 첫 화면 · 스토어 가입 · 앱은 열고 콘솔 · 로그인은 기본 도메인으로', () => {
  assert.equal(appsPathKind('/'), 'home');
  assert.equal(appsPathKind('/join'), 'web');
  assert.equal(appsPathKind('/rss.xml'), 'web');
  for (const console of ['/admin', '/admin/chats', '/login', '/install', '/connect', '/pages/x'])
    assert.equal(appsPathKind(console), 'console', console);
  for (const none of ['/_/login', '/~abc']) assert.equal(appsPathKind(none), 'none', none);
  assert.equal(appsPathKind('/words'), 'app');
  assert.equal(appsPathKind('/words/_/login'), 'app');
});

test('기본 도메인: 첫 화면과 앱 주소만 넘기고 미리 보기 · 콘솔은 그대로', () => {
  assert.equal(movesToApps('/'), true);
  assert.equal(movesToApps('/words'), true);
  assert.equal(movesToApps('/words/t/1'), true);
  for (const stay of [
    '/admin',
    '/login',
    '/words/~abc',
    '/words/~abc/_/cairn.js',
    '/sw.js',
    '/share/x',
  ])
    assert.equal(movesToApps(stay), false, stay);
});

test('고정 화면은 둘째 칸이 _', () => {
  assert.equal(isAppsMemberScreen('/words/_/login'), true);
  assert.equal(isAppsMemberScreen('/words/t/1'), false);
});
