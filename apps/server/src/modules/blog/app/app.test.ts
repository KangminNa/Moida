import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation, SecretBox } from '../../platform';
import { App } from './app';
import { AppDomainProof } from './app-domain.policy';

// 앱 도메인의 규칙 (스토어 3-0): 받는 모양 · 바꿔 두는 모양 · 받지 않는 값, 연결 확인 값.
// 사이트 주소와 같은 도메인은 API 테스트에서 사이트 주소를 바꾸지 않고 보려고 여기서 본다 (다른 테스트와 DB의 사이트 주소를 함께 쓴다).

const NOW = new Date('2026-11-19T00:00:00Z');
const SITE = 'cairn.example.com';

describe('App.checkDomain', () => {
  test('소문자로, 끝의 점을 빼고, 국제 도메인은 xn-- 꼴로 둔다', () => {
    assert.equal(App.checkDomain('  Blog.Example.COM. ', SITE), 'blog.example.com');
    assert.equal(App.checkDomain('my-shop.co.kr', SITE), 'my-shop.co.kr');
    assert.match(App.checkDomain('블로그.한국', SITE), /^xn--[a-z0-9-]+\.xn--[a-z0-9-]+$/);
    assert.equal(App.checkDomain('cairn.example.com.au', SITE), 'cairn.example.com.au');
  });

  test('주소 · 포트 · 경로 · IP · localhost · 이름 하나 · 사이트 주소의 도메인은 받지 않는다', () => {
    const refused: readonly [string, RegExp][] = [
      ['https://blog.example.com', /도메인만/],
      ['blog.example.com:8443', /도메인만/],
      ['blog.example.com/news', /도메인만/],
      ['user@blog.example.com', /도메인만/],
      ['[::1]', /도메인만/],
      ['203.0.113.7', /IP 주소/],
      ['0x7f.1', /IP 주소/],
      ['localhost', /localhost/],
      ['app.localhost', /localhost/],
      ['intranet', /모양이 아니에요/],
      ['-bad.example.com', /모양이 아니에요/],
      [`${'a'.repeat(64)}.example.com`, /모양이 아니에요/],
      ['Cairn.Example.com', /사이트 주소와 같은/],
    ];
    for (const [value, why] of refused)
      assert.throws(
        () => App.checkDomain(value, SITE),
        (e: unknown) => e instanceof RuleViolation && why.test(e.message),
        value,
      );
  });

  test('도메인을 바꾸면 연결 확인을 비우고, 같은 값이면 그대로다', () => {
    const app = App.open('s1', 'blog', { name: '블로그', slug: 'blog' }, NOW);
    const proof = new AppDomainProof(SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() }));
    app.setDomain('blog.example.com', SITE, NOW);
    app.confirmDomain(proof, proof.tokenOf(app.id, 'blog.example.com'), NOW);
    assert.equal(app.view().toJSON().domainCheckedAt, NOW.toISOString());
    app.setDomain('BLOG.example.com', SITE, NOW);
    assert.equal(app.view().toJSON().domainCheckedAt, NOW.toISOString(), '같은 도메인');
    app.setDomain('news.example.com', SITE, NOW);
    assert.deepEqual(
      [app.domain, app.view().toJSON().domainCheckedAt, app.view().toJSON().url],
      ['news.example.com', null, '/blog'],
    );
    app.setDomain('', SITE, NOW);
    assert.equal(app.domain, null);
    assert.throws(() => app.confirmDomain(proof, 'x', NOW), /도메인부터/);
  });
});

describe('AppDomainProof', () => {
  const box = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });
  const proof = new AppDomainProof(box);

  test('같은 앱 · 도메인이면 같은 값, 앱이나 도메인이나 서버 키가 다르면 맞지 않는다', () => {
    const token = proof.tokenOf('a1', 'blog.example.com');
    assert.equal(proof.tokenOf('a1', 'blog.example.com'), token);
    assert.equal(proof.matches('a1', 'blog.example.com', token), true);
    assert.equal(proof.matches('a2', 'blog.example.com', token), false);
    assert.equal(proof.matches('a1', 'shop.example.com', token), false);
    assert.equal(proof.matches('a1', 'blog.example.com', `${token}x`), false);
    const other = new AppDomainProof(SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() }));
    assert.equal(other.matches('a1', 'blog.example.com', token), false);
  });
});
