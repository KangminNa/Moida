import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostOf, originOf } from './request-host.ts';

// 앱 도메인을 고를 호스트 (스토어 3-0): 앞단 프록시의 X-Forwarded-Host가 먼저, 소문자 · 포트 · 끝의 점 없이

test('X-Forwarded-Host(첫 값)가 먼저, 없으면 Host', () => {
  const h = (init: Record<string, string>) => hostOf(new Headers(init));
  assert.equal(h({ host: 'Blog.Example.com:443' }), 'blog.example.com');
  assert.equal(
    h({ host: 'web:3000', 'x-forwarded-host': 'Shop.Example.com, proxy.local' }),
    'shop.example.com',
  );
  assert.equal(h({ host: 'blog.example.com.' }), 'blog.example.com');
  assert.equal(h({ host: '[::1]:3000' }), '[::1]');
  assert.equal(h({}), null);
});

test('출처는 X-Forwarded-Proto가 먼저, 포트는 그대로', () => {
  const o = (init: Record<string, string>) => originOf(new Headers(init), 'http:');
  assert.equal(
    o({ host: 'web:3000', 'x-forwarded-host': 'Shop.Example.com', 'x-forwarded-proto': 'https' }),
    'https://shop.example.com',
  );
  assert.equal(o({ host: 'shop.test:3000' }), 'http://shop.test:3000');
  assert.equal(o({ host: 'shop.test.' }), 'http://shop.test');
});
