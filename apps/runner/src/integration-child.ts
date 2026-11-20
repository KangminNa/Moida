/** 자식 프로세스의 표시: 결과 · 연 탭 (stdout의 다른 글과 섞이지 않게) */
export const RESULT_MARK = '@@cairn-site-result@@';
export const PAGE_MARK = '@@cairn-site-page@@';

/**
 * 사이트 도구 코드를 돌리는 자식 프로세스의 코드 (CommonJS, -e로 넘긴다: 러너의 TS 등록 없이 돈다). 표준 입력으로 일을 받는다.
 * 지금 브라우저(CDP)의 기본 컨텍스트(유지 로그인)에 새 탭 하나를 열고, 그 탭의 문서 이동은 허용 출처로만 둔다.
 *   읽기 도구: 문서 이동의 POST를 막는다 (XHR · fetch로 읽는 사이트가 있어 그것은 둔다)
 *   쓰기 도구(2026-11-16 MCP 3단계): commit 전에는 GET이 아닌 요청을 모두 막고, site.commit(locator) 한 번에서만 연다
 *     (그 뒤에도 허용 출처로만). 시험은 마른 실행: commit 대상이 정확히 하나 · 보임 · 누를 수 있음까지 보고 멈춘다
 * site.api(경로, { query }) (B3, 2026-11-19): 화면 대신 사이트의 API를 GET으로 부른다. 허용 출처 안 · 리다이렉트 없음 · 2MB · 15초,
 *   이 컨텍스트(유지 로그인)의 쿠키로. 답은 { status, ok, json, text }. GET만이라 읽기 · 쓰기 도구 모두 commit과 상관없다
 * 도구 코드는 vm의 빈 맥락에서 page · input · site만 받아 돈다. 끝나면 탭을 닫고 결과 한 줄을 쓴다
 */
export const CHILD_SOURCE = `
const vm = require('node:vm');
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const write = job.mode === 'write';
  const send = (m) => process.stdout.write('\\n${RESULT_MARK}' + JSON.stringify(m) + '\\n');
  const DRY = { cairnDry: true };
  let browser = null;
  let page = null;
  let called = false;
  let reached = false;
  let committed = false;
  try {
    const { chromium } = require(job.playwright);
    browser = await chromium.connectOverCDP(job.cdp, { timeout: 10000 });
    const context = browser.contexts()[0] || (await browser.newContext());
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const info = await cdp.send('Target.getTargetInfo');
    await cdp.detach();
    process.stdout.write('\\n${PAGE_MARK}' + info.targetInfo.targetId + '\\n');
    const allowed = new Set(job.origins);
    await page.route('**/*', (route) => {
      const r = route.request();
      let origin = '';
      try { origin = new URL(r.url()).origin; } catch {}
      const navigation = r.isNavigationRequest() && r.frame() === page.mainFrame();
      if (navigation && !allowed.has(origin)) return route.abort('blockedbyclient');
      if (r.method() !== 'GET') {
        const blocked = write ? !committed || !allowed.has(origin) : navigation;
        if (blocked) return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const site = Object.freeze({
      origin: new URL(job.startUrl).origin,
      start_url: job.startUrl,
      loginNeeded: (why) => {
        const e = new Error(String(why || '로그인이 필요해요'));
        e.cairnLogin = true;
        throw e;
      },
      api: async (path, options) => {
        const url = new URL(String(path), new URL(job.startUrl).origin);
        if (!allowed.has(url.origin)) throw new Error('허용 출처 밖이에요: ' + url.origin);
        const query = (options && options.query) || {};
        for (const k of Object.keys(query)) url.searchParams.set(k, String(query[k]));
        const res = await context.request.get(url.toString(), { timeout: 15000, maxRedirects: 0, failOnStatusCode: false });
        const body = await res.body();
        if (body.length > 2097152) throw new Error('API 답이 2MB를 넘어요');
        const text = body.toString('utf8');
        let json = null;
        if (/json/i.test(String(res.headers()['content-type'] || ''))) {
          try { json = JSON.parse(text); } catch { json = null; }
        }
        return Object.freeze({ status: res.status(), ok: res.ok(), json, text: json === null ? text.slice(0, 200000) : null });
      },
      commit: async (target) => {
        if (!write) throw new Error('읽기 도구는 commit을 쓰지 않아요');
        if (called) throw new Error('commit은 한 번만 해요');
        called = true;
        const count = await target.count();
        if (count !== 1) throw new Error('commit할 대상이 하나가 아니에요 (' + count + '개)');
        if (!(await target.isVisible()) || !(await target.isEnabled()))
          throw new Error('commit할 대상이 보이지 않거나 누를 수 없어요');
        reached = true;
        if (job.dryRun) throw DRY;
        committed = true;
        await target.click();
      },
    });
    const run = vm.runInNewContext('(async ({ page, input, site }) => {\\n' + job.code + '\\n})', Object.create(null), { timeout: 1000 });
    const output = await run({ page, input: job.input, site });
    if (job.dryRun && reached) send({ ok: true, output: {}, dry: true });
    else if (write && !committed) send({ ok: false, error: 'commit하지 않고 끝났어요', kind: 'code', committed });
    else send({ ok: true, output });
  } catch (e) {
    if (e === DRY || (job.dryRun && reached && !committed)) send({ ok: true, output: {}, dry: true });
    else {
      const message = String((e && e.message) || e).split('\\n')[0].slice(0, 500);
      send({ ok: false, error: message, kind: e && e.cairnLogin ? 'login' : 'code', committed });
    }
  } finally {
    try { if (page) await page.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
    process.exit(0);
  }
});
`;
