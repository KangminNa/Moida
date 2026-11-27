import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memberReturn } from './return-path.ts';

test('앱 도메인 안의 경로만, 가입 · 로그인 화면은 첫 화면으로', () => {
  assert.equal(memberReturn('/t/a1?x=1'), '/t/a1?x=1');
  assert.equal(memberReturn('/_/write'), '/_/write');
  for (const bad of [null, '', 'https://evil.com', '//evil.com', '/\\evil.com', '/\t/evil.com'])
    assert.equal(memberReturn(bad), '/', String(bad));
  for (const loop of ['/_/login', '/_/login?return=/x', '/_/join', '/_/join/'])
    assert.equal(memberReturn(loop), '/', loop);
  assert.equal(memberReturn('/_/joinery'), '/_/joinery');
});

test('공통 앱 도메인: 뿌리가 /<앱>이면 첫 화면도 그 아래, 그 앱의 가입 · 로그인 화면도 첫 화면으로', () => {
  assert.equal(memberReturn(null, '/words'), '/words/');
  assert.equal(memberReturn('/words/t/a1', '/words'), '/words/t/a1');
  assert.equal(memberReturn('/words/_/login?return=/x', '/words'), '/words/');
  assert.equal(memberReturn('https://evil.com', '/words'), '/words/');
});
