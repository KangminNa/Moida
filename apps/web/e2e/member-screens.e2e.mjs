// 앱 도메인의 커뮤니티 고정 화면(/_/…, 스토어 3-2)이 브라우저에서 살아 있는지 처음부터 끝까지 본다.
//   - 가짜 Cairn API(127.0.0.1) 하나가 앱 도메인 목록 · 앱 · 회원을 답한다
//   - 실제 Next 서버를 개발(next dev)과 운영(next build → next start) 두 가지로 띄운다
//   - Chromium(창 없이)으로 앱 도메인에서 열어 React가 화면을 붙잡는지(하이드레이트), 칸에 쓰면 버튼이 켜지는지 본다
// 앱 도메인은 shotcafe.localhost: 브라우저가 이 컴퓨터로 풀고 프록시를 거치지 않으며, 개발 서버도 따로 허락하지 않아도 받는다.
// 개발 서버는 HMR 웹소켓이 붙지 않으면 화면을 하이드레이트하지 않는다 (2026-11-24: 나가는 프록시가 시험용 도메인의 웹소켓을
// 막아 회원 화면만 죽은 것처럼 보였다). 다른 도메인으로 시험하면 브라우저가 프록시를 거치지 않게 한다.
// Playwright(require('playwright'))와 그 Chromium이 없으면 건너뛴다.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const NEXT = require.resolve('next/dist/bin/next');
const APP = 'shotcafe';
const DOMAIN = `${APP}.localhost`;
const MEMBER = {
  id: '01930000-0000-7000-8000-000000000001',
  loginId: 'tester',
  nickname: '시험',
  joinedAt: '2026-11-01T00:00:00.000Z',
  writableAt: '2026-11-01T00:00:00.000Z',
  blockedUntil: null,
  version: 1,
};

function loadPlaywright() {
  try {
    const playwright = require('playwright');
    return existsSync(playwright.chromium.executablePath()) ? playwright : null;
  } catch {
    return null;
  }
}
const playwright = loadPlaywright();

/** 가짜 Cairn API: 웹이 회원 화면을 그릴 때 묻는 것만 답하고, 받은 쓰기를 적어 둔다 */
class FakeCairn {
  writes = [];
  #server = createServer((req, res) => this.#answer(req, res));

  async start() {
    await new Promise((done) => this.#server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${this.#server.address().port}`;
  }

  stop() {
    this.#server.closeAllConnections();
    return new Promise((done) => this.#server.close(done));
  }

  #answer(req, res) {
    const path = (req.url ?? '').split('?')[0];
    const member = (req.headers.cookie ?? '').includes('member=');
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (req.method !== 'GET') this.writes.push({ method: req.method, path, body });
      const reply = this.#reply(req.method, path, member);
      res.writeHead(reply ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply ?? { message: '없는 주소예요' }));
    });
  }

  #reply(method, path, member) {
    if (method === 'POST' && path === '/api/community/login') return MEMBER;
    if (method !== 'GET') return null;
    if (path === '/api/apps/domains') return { domains: [{ domain: DOMAIN, slug: APP }] };
    if (path === `/api/apps/by-slug/${APP}`)
      return { slug: APP, name: '샷카페', kind: 'community', members: true, theme: null };
    if (path === '/api/community/me')
      return member ? { member: MEMBER, csrf: 'csrf-1' } : { member: null, csrf: null };
    if (path === '/api/space') return { logoUrl: null };
    return null;
  }
}

/** 비어 있는 포트 하나 */
function freePort() {
  const probe = createServer();
  return new Promise((done) =>
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    }),
  );
}

/** Next 서버 하나 (next dev · next start). 자식 프로세스까지 함께 끝내도록 묶음으로 띄운다 */
async function startNext(mode, api) {
  const port = await freePort();
  const env = { ...process.env, API_URL: api, CAIRN_WEB_URL: '', NEXT_TELEMETRY_DISABLED: '1' };
  if (mode === 'start') {
    execFileSync(process.execPath, [join(web, '../../scripts/sync-plugins.mjs')], { cwd: web });
    execFileSync(process.execPath, [NEXT, 'build'], { cwd: web, env, stdio: 'pipe' });
  }
  const child = spawn(process.execPath, [NEXT, mode, '-p', String(port), '-H', '127.0.0.1'], {
    cwd: web,
    env,
    detached: true,
    stdio: 'ignore',
  });
  const origin = `http://127.0.0.1:${port}`;
  for (const end = Date.now() + 60_000; ; ) {
    if (await fetch(origin).catch(() => null)) break;
    if (Date.now() > end || child.exitCode !== null)
      throw new Error(`next ${mode}이 뜨지 않았어요`);
    await new Promise((done) => setTimeout(done, 200));
  }
  return {
    site: `http://${DOMAIN}:${port}`,
    stop: () => process.kill(-child.pid, 'SIGTERM'),
  };
}

/** React가 이 요소를 붙잡을 때까지 (하이드레이트). 서버가 그린 HTML만 있으면 칸에 써도 상태가 바뀌지 않는다 */
async function hydrated(page, selector) {
  await page
    .waitForFunction(
      (s) => {
        const el = document.querySelector(s);
        return el !== null && Object.keys(el).some((k) => k.startsWith('__react'));
      },
      selector,
      { timeout: 30_000 },
    )
    .catch(() => assert.fail(`${page.url()}의 ${selector}가 하이드레이트되지 않았어요`));
}

for (const mode of ['dev', 'start'])
  describe(`회원 화면 · 앱 도메인 (next ${mode})`, {
    skip: playwright ? false : 'Playwright · Chromium 없음',
  }, () => {
    const cairn = new FakeCairn();
    let next;
    let browser;

    before(async () => {
      next = await startNext(mode, await cairn.start());
      // 시험용 도메인도 이 컴퓨터로 (*.localhost는 브라우저가 스스로 풀지만 IPv6로 먼저 가지 않게)
      browser = await playwright.chromium.launch({
        args: [`--host-resolver-rules=MAP ${DOMAIN} 127.0.0.1`],
      });
    });

    after(async () => {
      await browser?.close();
      next?.stop();
      await cairn.stop();
    });

    it('로그인: 칸에 쓰면 버튼이 켜지고 눌러 회원 API로 보낸다', async () => {
      const page = await browser.newPage();
      const res = await page.goto(`${next.site}/_/login`);
      assert.equal(res?.status(), 200);
      assert.equal(res?.headers()['x-frame-options'], 'DENY'); // proxy.ts가 붙이는 화면 머리글
      await hydrated(page, 'form.member-form');
      const button = page.getByRole('button', { name: '로그인' });
      assert.equal(await button.isDisabled(), true);
      await page.getByLabel('아이디').fill('tester');
      await page.getByLabel('비밀번호').fill('pass-1234');
      assert.equal(await button.isEnabled(), true);
      await button.click();
      await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
      const login = cairn.writes.find((w) => w.path === '/api/community/login');
      assert.deepEqual(JSON.parse(login?.body ?? '{}'), {
        loginId: 'tester',
        password: 'pass-1234',
      });
      await page.close();
    });

    it('내 정보: 닉네임을 바꾸면 바꾸기 버튼이 켜진다', async () => {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'member', value: '1', url: next.site }]);
      const page = await context.newPage();
      await page.goto(`${next.site}/_/me`);
      await hydrated(page, 'form.member-form');
      const form = page.getByRole('form', { name: '닉네임 바꾸기' });
      const rename = form.getByRole('button', { name: '닉네임 바꾸기' });
      assert.equal(await rename.isDisabled(), true);
      await form.getByRole('textbox').fill('새 이름');
      assert.equal(await rename.isEnabled(), true);
      await context.close();
    });
  });
