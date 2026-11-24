import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { BrowserTabs, BrowserUnavailable, TabUnreadable } from './browser-tabs';
import { ExploreProxy } from './explore-proxy';
import { TestChromium } from './testing/test-chromium';

// 실제 Chromium으로 CDP 흐름을 본다: 새 탭 → 다 뜨면 제목과 보이는 글자 → 탭 닫기.
// Chromium이 없으면 건너뛴다 (CAIRN_TEST_CHROMIUM으로 경로를 줄 수 있다).
const { skip } = TestChromium;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>탭 시험</title></head><body>
<h1>보이는 글자</h1><p style="display:none">숨은 글자</p><div id="late"></div>
<script>setTimeout(() => { document.getElementById('late').textContent = '나중에 그린 글자'; }, 300);</script>
</body></html>`;

/** 자바스크립트로 그리는 페이지: 처음 HTML에는 글이 없고, 1초 뒤 목록을 그리고, 내리면 더 붙인다 */
const SPA = `<!doctype html><html><head><meta charset="utf-8"><title>청약 공고</title></head><body>
<div id="app">로딩 중</div><div id="more"></div><div id="cookie"></div>
<script>
document.getElementById('cookie').textContent = '쿠키[' + document.cookie + ']';
setTimeout(() => { document.getElementById('app').textContent = '공고 1 · 공고 2'; document.body.style.height = '5000px'; }, 1000);
let added = 0;
addEventListener('scroll', () => { if (added < 2) { added++; document.getElementById('more').textContent += ' 더 불러온 공고 ' + added; } });
</script></body></html>`;

let chromium: TestChromium;
let site: Server;
let siteUrl: string;
let endpoint: string;

before(async () => {
  if (skip) return;
  site = createServer((req, res) => {
    if (req.url === '/login')
      return res.writeHead(200, { 'set-cookie': 'sid=owner; Path=/' }).end('로그인');
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(req.url === '/spa' ? SPA : PAGE);
  });
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/page`;
  chromium = await TestChromium.start();
  endpoint = chromium.endpoint;
});

after(async () => {
  if (skip) return;
  await chromium.stop();
  site.close();
});

describe('BrowserTabs (실제 Chromium)', { skip }, () => {
  test('새 탭으로 열어 제목과 보이는 글자를 읽고, 그 탭을 닫는다', async () => {
    const tabs = new BrowserTabs(endpoint);
    const stop = new AbortController().signal;
    const read = await tabs.read(siteUrl, stop);
    assert.equal(read.title, '탭 시험');
    assert.match(read.body, /보이는 글자/);
    assert.match(read.body, /나중에 그린 글자/, '다 뜬 뒤 그려진 글자까지');
    assert.doesNotMatch(read.body, /숨은 글자/, '보이지 않는 글자는 빼고');
    assert.equal((await chromium.openUrls()).includes(siteUrl), false, '읽은 탭은 닫는다');
    assert.equal(
      getEventListeners(stop, 'abort').length,
      0,
      '러너의 stop에 리스너를 남기지 않는다',
    );
  });

  test('http · https가 아닌 주소와 열리지 않는 주소는 TabUnreadable, 닿지 않는 브라우저는 BrowserUnavailable', async () => {
    const stop = new AbortController().signal;
    await assert.rejects(new BrowserTabs(endpoint).read('file:///etc/passwd', stop), TabUnreadable);
    await assert.rejects(
      new BrowserTabs(endpoint).read('http://127.0.0.1:1/', stop),
      (error: Error) => error instanceof TabUnreadable && /열지 못했어요/.test(error.message),
    );
    await assert.rejects(
      new BrowserTabs('http://127.0.0.1:1').read(siteUrl, stop),
      (error: Error) => error instanceof BrowserUnavailable && /닿지 못했어요/.test(error.message),
    );
  });
});

describe('BrowserTabs: 자바스크립트로 그리는 페이지 · 일꾼의 빈 창 (실제 Chromium, 2026-11-24)', {
  skip,
}, () => {
  const spaUrl = () => siteUrl.replace('/page', '/spa');

  test('나중에 그린 글자와 내리면 더 불러오는 목록까지 기다려 읽는다', async () => {
    const read = await new BrowserTabs(endpoint).read(spaUrl(), new AbortController().signal);
    assert.equal(read.title, '청약 공고');
    assert.match(read.body, /공고 1 · 공고 2/, '1초 뒤에 그린 글자');
    assert.match(read.body, /더 불러온 공고 1/, '내려서 더 불러온 글자');
    assert.doesNotMatch(read.body, /로딩 중/);
  });

  test('일꾼의 읽기는 쿠키 없는 빈 컨텍스트에서 프록시로만 나가고, 끝나면 컨텍스트째 지운다', async () => {
    const tabs = new BrowserTabs(endpoint);
    const stop = new AbortController().signal;
    await tabs.read(siteUrl.replace('/page', '/login'), stop);
    const own = await tabs.read(spaUrl(), stop);
    assert.match(own.body, /쿠키\[sid=owner\]/, '관리자의 읽기는 로그인된 프로필 그대로');
    // 시험의 사이트가 127.0.0.1이라 이 프록시만 내부 주소를 열어 준다 (운영은 ExploreProxy.internal로 막는다)
    const open = await ExploreProxy.start(() => false);
    try {
      const blank = await tabs.read(spaUrl(), stop, open.url);
      assert.match(blank.body, /쿠키\[\]/, '빈 컨텍스트에는 쿠키가 없다');
      assert.match(blank.body, /공고 1/);
    } finally {
      await open.close();
    }
    assert.equal(
      (await chromium.openUrls()).includes(spaUrl()),
      false,
      '빈 컨텍스트의 탭도 닫힌다',
    );
  });

  test('일꾼의 빈 창은 내부 주소(이 러너 · 내부망)를 열지 못한다', async () => {
    const guard = await ExploreProxy.start();
    try {
      const read = await new BrowserTabs(endpoint)
        .read(spaUrl(), new AbortController().signal, guard.url)
        .catch((error: Error) => error);
      if (read instanceof Error) assert.ok(read instanceof TabUnreadable, read.message);
      else assert.doesNotMatch(read.body, /공고|쿠키/, '프록시가 막아 페이지 글이 없다');
    } finally {
      await guard.close();
    }
  });
});
