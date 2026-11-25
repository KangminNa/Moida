import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devOrigins } from './dev-origins.ts';

test('웹 주소의 호스트 · 시험용 .test · CAIRN_DEV_ORIGINS를 개발 서버의 출처로 허락한다', () => {
  assert.deepEqual(
    devOrigins({
      CAIRN_WEB_URL: 'http://blog.example.com:3000',
      CAIRN_DEV_ORIGINS: ' *.Example.org , ,shop.example.net',
    }),
    ['blog.example.com', '**.test', '*.example.org', 'shop.example.net'],
  );
});

test('웹 주소가 없거나 틀려도 앱 도메인(.test)은 허락한다', () => {
  assert.deepEqual(devOrigins({}), ['**.test']);
  assert.deepEqual(devOrigins({ CAIRN_WEB_URL: '주소 아님' }), ['**.test']);
});
