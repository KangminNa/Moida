import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fallbackOf } from './app-fallback.ts';

// 정적 앱의 검색용 기본 HTML (2026-11-25, docs/스토어.md 14장 A3)

describe('fallbackOf', () => {
  test('글 화면은 제목과 거른 본문 HTML을 noscript에 싣는다', () => {
    const html = fallbackOf({
      app: { name: '빵집' },
      post: { title: '오늘의 <빵>', html: '<p>바게트</p>' },
    });
    assert.equal(
      html,
      '<noscript><main><article><h1>오늘의 &lt;빵&gt;</h1><p>바게트</p></article></main></noscript>',
    );
  });

  test('목록 화면은 앱 이름 · 설명과 글 링크, 안전하지 않은 주소는 링크로 걸지 않는다', () => {
    const html = fallbackOf({
      app: { name: '빵집', description: '동네 빵집' },
      posts: [
        { title: '첫 글', url: '/bakery/posts/first', excerpt: '처음' },
        { title: '나쁜 글', url: 'javascript:alert(1)' },
      ],
    });
    assert.match(html, /<h1>빵집<\/h1><p>동네 빵집<\/p>/);
    assert.match(html, /<a href="\/bakery\/posts\/first">첫 글<\/a><p>처음<\/p>/);
    assert.match(html, /<li>나쁜 글<\/li>/);
    assert.doesNotMatch(html, /javascript:/);
  });

  test('실을 것이 없으면 빈 글', () => {
    assert.equal(fallbackOf({}), '');
  });
});
