import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consoleUrlOn, isConsolePath } from './console-path.ts';

// 앱 도메인의 /admin → 사이트 주소의 콘솔 (2026-11-25)

test('콘솔 주소만 사이트 출처로 보낸다 (경로 · 쿼리 그대로)', () => {
  const site = 'https://cairn.example.com';
  assert.equal(consoleUrlOn(site, '/admin', ''), `${site}/admin`);
  assert.equal(consoleUrlOn(site, '/admin/store/a', '?tab=code'), `${site}/admin/store/a?tab=code`);
  assert.equal(consoleUrlOn(site, '/administrator', ''), null, '앱의 주소');
  assert.equal(consoleUrlOn(site, '/', ''), null);
  assert.equal(consoleUrlOn(null, '/admin', ''), null, '사이트 주소를 정하기 전');
  assert.equal(isConsolePath('/admin/'), true);
});
