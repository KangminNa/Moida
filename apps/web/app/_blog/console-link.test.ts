import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { withConsoleLink } from './console-link.ts';

// 관리자가 연 앱 화면의 "콘솔로" 링크 (2026-11-25)

describe('withConsoleLink', () => {
  const page = '<html><body><main>앱</main></body></html>';

  test('관리자 화면이면 </body> 앞에 콘솔 링크를 붙인다', () => {
    const html = withConsoleLink(page, '/admin/store/0193', false);
    assert.match(html, /<main>앱<\/main><a href="\/admin\/store\/0193"[^>]*>콘솔로<\/a><\/body>/);
  });

  test('방문자 · 콘솔 미리 보기 틀 · 콘솔 밖 주소는 그대로', () => {
    assert.equal(withConsoleLink(page, null, false), page);
    assert.equal(withConsoleLink(page, '/admin/store/0193', true), page);
    assert.equal(withConsoleLink(page, 'https://evil.test/admin/', false), page);
  });

  test('</body>가 없으면 끝에 붙이고, 따옴표는 주소 밖으로 새지 않는다', () => {
    const html = withConsoleLink('<p>앱</p>', '/admin/store/"x', false);
    assert.ok(html.startsWith('<p>앱</p><a href="/admin/store/%22x"'));
  });
});
