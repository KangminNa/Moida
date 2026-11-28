import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';

// 링크 미리보기 (F3, 2026-11-21): 관리자만. 서버가 read_url과 같은 길로 주소를 열어 제목 · 사이트 · 설명 · 대표 그림을 읽고,
// 그림은 미리보기한 페이지의 대표 그림만 서버를 거쳐 준다. 바깥 사이트 대신 127.0.0.1의 테스트용 웹 서버 (테스트에서만 루프백을 연다)

type Json = Record<string, unknown>;
/** WebPageGateway.TEST_LOOPBACK_ENV (모듈 안을 가져오지 않으려고 이름만) */
const LOOPBACK = 'MOIDA_READ_URL_TEST_LOOPBACK';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);

let api: ApiClient;
let owner: TestUser;
let site: Server;
let base: string;
let opened = 0;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};
const preview = (path: string, as = owner) =>
  api.get(`/api/link-preview?url=${encodeURIComponent(`${base}${path}`)}`, as);
const image = (path: string, as = owner) =>
  api.get(`/api/link-preview/image?url=${encodeURIComponent(`${base}${path}`)}`, as);

before(async () => {
  process.env[LOOPBACK] = '1';
  site = createServer((req, res) => {
    if (req.url === '/place') {
      opened++;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<html><head><title>동성로 카페 : 지도</title>
        <meta property="og:site_name" content="테스트 지도">
        <meta name="description" content="대구 중구 &amp; 동성로">
        <meta property="og:image" content="/pic.png"></head><body>본문</body></html>`);
    } else if (req.url === '/plain') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>그냥 페이지</title><p>글</p>');
    } else if (req.url === '/fake') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>가짜 그림</title><meta property="og:image" content="/not-image">');
    } else if (req.url === '/pic.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    } else if (req.url === '/not-image') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end('<svg onload="alert(1)"></svg>');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  api = await ApiClient.start();
  owner = await api.signIn();
});

after(async () => {
  delete process.env[LOOPBACK];
  site.close();
  await api.close();
});

describe('링크 미리보기', () => {
  test('방문자 · write 기기는 못 본다 (관리자만)', async () => {
    assert.equal((await preview('/place', TestUser.visitor)).status, 403);
    const device = await api.writeDevice(owner, 'preview-writer');
    const res = await api.request(
      'GET',
      `/api/link-preview?url=${encodeURIComponent(`${base}/place`)}`,
      TestUser.visitor,
      undefined,
      { authorization: `Bearer ${device}` },
    );
    assert.equal(res.status, 403);
    assert.equal((await image('/place', TestUser.visitor)).status, 403);
  });

  test('제목 · 사이트 · 설명 · 대표 그림을 읽고 하루 기억한다. 그림은 서버를 거쳐 그림 형식으로만', async () => {
    const card = ok(await preview('/place'));
    assert.deepEqual(card, {
      url: `${base}/place`,
      title: '동성로 카페 : 지도',
      site: '테스트 지도',
      description: '대구 중구 & 동성로',
      image: true,
    });
    ok(await preview('/place'));
    assert.equal(opened, 1, '같은 주소는 다시 열지 않는다');
    const pic = await image('/place');
    assert.equal(pic.status, 200);
    assert.equal(pic.header('content-type'), 'image/png');
    assert.equal(pic.header('x-content-type-options'), 'nosniff');
    assert.match(pic.header('content-security-policy') ?? '', /default-src 'none'; sandbox/);
    const fake = await image('/fake');
    assert.equal(fake.status, 422, '그림이 아닌 것은 그림 형식이라고 해도 주지 않는다');
  });

  test('메타 태그가 없으면 호스트를 사이트로, 그림은 404. 열지 못한 주소도 카드 대신 주소만 (오류가 아니다)', async () => {
    const plain = ok(await preview('/plain'));
    assert.deepEqual([plain.title, plain.site, plain.image], ['그냥 페이지', '127.0.0.1', false]);
    assert.equal((await image('/plain')).status, 404);
    const missing = ok(await preview('/missing'));
    assert.deepEqual([missing.title, missing.site, missing.image], ['', '127.0.0.1', false]);
    const bad = await api.get('/api/link-preview?url=ftp%3A%2F%2Fexample.com%2Fa', owner);
    assert.equal(bad.status, 400);
  });

  test('내부망 · 이 서버의 주소는 열지 않는다 (테스트 루프백을 끄면 127.0.0.1도 막힌다)', async () => {
    delete process.env[LOOPBACK];
    try {
      const inner = ok(await preview('/plain?inner=1'));
      assert.deepEqual([inner.title, inner.image], ['', false]);
    } finally {
      process.env[LOOPBACK] = '1';
    }
  });
});
