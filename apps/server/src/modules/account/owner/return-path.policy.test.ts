import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReturnPath } from './return-path.policy';

test('돌아갈 곳: 이 사이트 안의 경로는 해석한 모양 그대로', () => {
  assert.equal(ReturnPath.safe('/'), '/');
  assert.equal(ReturnPath.safe('/admin/store?tab=team#top'), '/admin/store?tab=team#top');
  assert.equal(ReturnPath.safe('/connect?request=abc%2Fdef'), '/connect?request=abc%2Fdef');
  // 인코딩된 \ · /는 경로의 글자일 뿐이다 (브라우저도 다른 사이트로 읽지 않는다)
  assert.equal(ReturnPath.safe('/%5Cevil.com'), '/%5Cevil.com');
  assert.equal(ReturnPath.safe('/%2F%2Fevil.com'), '/%2F%2Fevil.com');
});

test('돌아갈 곳: 브라우저가 다른 사이트로 읽는 값은 모두 거절 (열린 리다이렉트)', () => {
  for (const raw of [
    '',
    'evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    '//evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    '\\\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r\n/evil.com',
  ])
    assert.equal(ReturnPath.safe(raw), null, JSON.stringify(raw));
});
