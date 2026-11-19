import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeReturnPath } from './return-path.ts';

test('돌아갈 곳: 이 사이트 안의 경로는 해석한 모양 그대로, 없으면 콘솔', () => {
  assert.equal(safeReturnPath('/admin/store?tab=team#top'), '/admin/store?tab=team#top');
  assert.equal(safeReturnPath('/connect?request=abc%2Fdef'), '/connect?request=abc%2Fdef');
  assert.equal(safeReturnPath('/%5Cevil.com'), '/%5Cevil.com');
  assert.equal(safeReturnPath(undefined), '/admin');
  assert.equal(safeReturnPath(null, '/'), '/');
});

test('돌아갈 곳: 브라우저가 다른 사이트로 읽는 값은 모두 콘솔로 (열린 리다이렉트)', () => {
  for (const raw of [
    '',
    'evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    '//evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r\n/evil.com',
  ])
    assert.equal(safeReturnPath(raw), '/admin', JSON.stringify(raw));
});
