import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devOrigins } from './dev-origins.ts';

test('웹 주소의 호스트 · 시험용 .test · MOIDA_DEV_ORIGINS를 개발 서버의 출처로 허락한다', () => {
  assert.deepEqual(
    devOrigins({
      MOIDA_WEB_URL: 'http://blog.example.com:3000',
      MOIDA_DEV_ORIGINS: ' *.Example.org , ,shop.example.net',
    }),
    ['blog.example.com', '**.test', '*.example.org', 'shop.example.net'],
  );
});

test('웹 주소가 없거나 틀려도 앱 도메인(.test)은 허락한다', () => {
  assert.deepEqual(devOrigins({}), ['**.test']);
  assert.deepEqual(devOrigins({ MOIDA_WEB_URL: '주소 아님' }), ['**.test']);
});

test('옛 이름(CAIRN_*)으로만 적은 배포의 값도 읽고, 새 이름이 먼저다 (2026-11-28 이름 cairn → moida)', () => {
  assert.deepEqual(
    devOrigins({ CAIRN_WEB_URL: 'http://old.example.com', CAIRN_DEV_ORIGINS: 'x.example.org' }),
    ['old.example.com', '**.test', 'x.example.org'],
  );
  assert.deepEqual(
    devOrigins({
      CAIRN_WEB_URL: 'http://old.example.com',
      MOIDA_WEB_URL: 'http://new.example.com',
    }),
    ['new.example.com', '**.test'],
  );
});
