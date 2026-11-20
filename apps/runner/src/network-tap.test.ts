import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { ApiShape } from './api-shape';
import { pause } from './backoff';
import { BrowserPages } from './browser-page';
import { DevToolsSession } from './browser-tabs';
import { NetworkTap } from './network-tap';
import { TestChromium } from './testing/test-chromium';

// 요청 기록 (B2, 2026-11-19): 사이트 일 동안 그 사이트로 가는 XHR · fetch의 모양만 남긴다. 값은 하나도 남기지 않는다.

describe('요청의 모양 (ApiShape)', () => {
  test('경로의 숫자 · id 조각은 틀로, 쿼리 · 폼은 이름만', () => {
    assert.equal(
      ApiShape.pathOf('/users/123/orders/9f1c2e4a-1b2c-4d5e-8f90-112233445566'),
      '/users/{n}/orders/{id}',
    );
    assert.equal(ApiShape.pathOf('/api/v2/items'), '/api/v2/items');
    assert.deepEqual(ApiShape.queryOf(new URLSearchParams('q=비밀&page=2&q=x&me@a.com=1')), [
      'page',
      'q',
    ]);
    assert.deepEqual(ApiShape.bodyOf('id=me&pw=secret', 'application/x-www-form-urlencoded'), {
      id: 'string',
      pw: 'string',
    });
  });

  test('JSON은 칸 이름과 종류만 (목록은 첫 항목, 깊이 4)', () => {
    const shape = ApiShape.shapeOf(
      {
        items: [{ id: 7, name: '비밀 이름', tags: ['a'] }],
        total: 3,
        next: null,
        deep: { a: { b: { c: { d: 1 } } } },
      },
      0,
    );
    assert.deepEqual(shape, {
      items: [{ id: 'number', name: 'string', tags: ['string'] }],
      total: 'number',
      next: 'null',
      deep: { a: { b: { c: {} } } },
    });
    assert.doesNotMatch(JSON.stringify(shape), /비밀/);
  });
});

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>목록</title></head><body>
<script>
  fetch('/api/items?page=2&q=secret-query').then((r) => r.json());
  fetch('/api/orders/123', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ qty: 2, memo: 'secret-memo' }) });
  fetch('http://127.0.0.2:9/elsewhere').catch(() => {});
</script></body></html>`;

describe('요청 기록 (실제 Chromium)', { skip: TestChromium.skip }, () => {
  let chromium: TestChromium;
  let site: Server;
  let origin: string;

  before(async () => {
    site = createServer((req, res) => {
      if (req.url?.startsWith('/api/items')) {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ items: [{ id: 1, title: 'secret-title' }], total: 1 }));
      }
      if (req.url?.startsWith('/api/orders')) {
        req.resume();
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ ok: true }));
      }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(PAGE);
    });
    await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
    chromium = await TestChromium.start();
  });

  after(async () => {
    await chromium.stop();
    site.closeAllConnections();
    site.close();
  });

  test('사이트의 XHR · fetch 모양만 모으고, 다른 출처 · 값은 남기지 않는다', async () => {
    const pages = new BrowserPages(chromium.endpoint);
    const tap = new NetworkTap(pages, [origin]);
    tap.start();
    // AI처럼: 빈 탭을 열고(러너가 붙는다) 그 탭에서 사이트로 이동한다
    const tab = await pages.open('about:blank', AbortSignal.timeout(10_000));
    await pause(1_000);
    const s = await DevToolsSession.open(tab.socket, AbortSignal.timeout(10_000));
    await s.send('Page.navigate', { url: `${origin}/list` });
    await pause(1_500);
    s.close();
    const calls = tap.stop();
    const byPath = new Map(calls.map((c) => [`${c.method} ${c.path}`, c]));
    const list = byPath.get('GET /api/items');
    assert.ok(list, JSON.stringify(calls));
    assert.deepEqual(
      [list.origin, list.query, list.status, list.response],
      [origin, ['page', 'q'], 200, { items: [{ id: 'number', title: 'string' }], total: 'number' }],
    );
    const order = byPath.get('POST /api/orders/{n}');
    assert.deepEqual(order?.body, { qty: 'number', memo: 'string' });
    assert.equal(
      calls.some((c) => c.origin !== origin),
      false,
      '다른 출처는 남기지 않는다',
    );
    assert.doesNotMatch(JSON.stringify(calls), /secret/);
  });
});
