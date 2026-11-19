import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from './markdown.ts';

test('글의 바깥 주소 링크는 새 탭 · noopener noreferrer, 사이트 안 주소는 같은 탭 (웹 UX U3)', () => {
  const html = renderMarkdown(
    '[밖](https://example.com/a) · [안](/m/notes) · [평문](http://example.org)',
  );
  assert.match(
    html,
    /<a href="https:\/\/example\.com\/a" target="_blank" rel="noopener noreferrer">밖<\/a>/,
  );
  assert.match(html, /<a href="\/m\/notes">안<\/a>/);
  assert.match(
    html,
    /<a href="http:\/\/example\.org" target="_blank" rel="noopener noreferrer">평문<\/a>/,
  );
});

test('거르기는 그대로: javascript: 링크는 주소가 지워지고 새 탭도 붙지 않는다', () => {
  const html = renderMarkdown('[x](javascript:alert(1))');
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /target=/);
});
