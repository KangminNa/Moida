import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { IntegrationExec } from './integration-exec';
import { IntegrationRules } from './integration-rules';
import { TestChromium } from './testing/test-chromium';

// 사이트 도구 실행 (2026-11-16 MCP 2단계): 규칙 검사, 자식 프로세스(권한 모델) · 허용 출처 · 로그인 · 시간 넘김 (실제 Chromium)

const never = new AbortController().signal;

describe('IntegrationRules', () => {
  test('page로 읽는 코드는 통과', () => {
    const code = [
      'await page.goto(site.start_url);',
      "const rows = await page.getByRole('row').allTextContents();",
      "const names = ['a', 'b'];",
      'return { rows, names, n: input.n };',
    ].join('\n');
    assert.deepEqual(IntegrationRules.problems(code), []);
  });

  test('모듈 · 프로세스 · 다른 탭 · 요청 API · 글자로 칸 접근 · 이스케이프 · 비밀값은 막는다', () => {
    const cases: [string, RegExp][] = [
      ["const fs = require('fs')", /require/],
      ['return process.env', /process/],
      ['page.constructor.constructor("return 1")()', /constructor/],
      ['const p = await page.context().newPage()', /context.*newPage|newPage/],
      ['await page.request.get("https://x")', /request/],
      ["await page.waitForEvent('popup')", /popup/],
      ["page['evaluate']", /칸에 닿는/],
      ['const s = "\\u0072equire"', /이스케이프/],
      ['const key = "sk-abcdefghijklmnopqrstu"', /비밀값/],
      ['', /비었어요/],
      ["await site.commit(page.getByRole('button'))", /읽기 도구는 site.commit/],
    ];
    for (const [code, why] of cases)
      assert.match(IntegrationRules.problems(code).join(' '), why, code);
  });
});

describe('IntegrationRules (쓰기 도구)', () => {
  test('쓰기 도구는 site.commit이 정확히 한 번', () => {
    const one =
      "await page.goto(site.start_url);\nawait site.commit(page.getByRole('button', { name: '게시' }));";
    assert.deepEqual(IntegrationRules.problems(one, 'write'), []);
    assert.match(
      IntegrationRules.problems('return {};', 'write').join(' '),
      /정확히 한 번 써요 \(0번\)/,
    );
    assert.match(IntegrationRules.problems(`${one}\n${one}`, 'write').join(' '), /\(2번\)/);
  });
});

describe('IntegrationExec.outcomeOf', () => {
  test('마지막 결과 줄을 읽고, 없거나 객체가 아니면 실패', () => {
    const line = (m: object) => `로그\n@@cairn-site-result@@${JSON.stringify(m)}\n`;
    assert.deepEqual(IntegrationExec.outcomeOf(line({ ok: true, output: { a: 1 } }), 5), {
      ok: true,
      output: { a: 1 },
      ms: 5,
    });
    assert.equal(IntegrationExec.outcomeOf(line({ ok: true, output: [1] }), 5).ok, false);
    const login = IntegrationExec.outcomeOf(line({ ok: false, error: '로그인', kind: 'login' }), 1);
    assert.deepEqual([login.ok, !login.ok && login.kind], [false, 'login']);
    assert.equal(IntegrationExec.outcomeOf('아무것도 없음', 1).ok, false);
  });
});

describe('IntegrationExec (실제 Chromium)', { skip: TestChromium.skip }, () => {
  let chromium: TestChromium;
  let server: Server;
  let origin = '';
  let exec: IntegrationExec;
  let posts = 0;

  before(async () => {
    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.method === 'POST') {
        posts++;
        return res.end('<h1>올렸어요</h1>');
      }
      if (req.url === '/form')
        return res.end(
          '<form method="post" action="/submit"><input aria-label="제목" name="t"><button>게시</button></form>' +
            '<button type="button" onclick="fetch(\'/ping\', { method: \'POST\' }).catch(() => {})">미리 보내기</button>',
        );
      if (req.url === '/twice') return res.end('<button>게시</button><button>게시</button>');
      if (req.url?.startsWith('/q/'))
        return res.end(`<h1>${decodeURIComponent(req.url.slice(3))}</h1><p id="price">71000</p>`);
      res.end('<h1>시세</h1>');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    chromium = await TestChromium.start();
    exec = new IntegrationExec(chromium.endpoint);
  });
  after(async () => {
    await chromium.stop();
    await new Promise((done) => server.close(done));
  });

  const site = () => ({ startUrl: `${origin}/`, origins: [origin] });

  test('허용 출처의 페이지를 읽어 답을 돌려주고, 연 탭은 닫는다', async () => {
    const code = [
      "await page.goto(site.origin + '/q/' + input.symbol);",
      "const price = Number(await page.locator('#price').textContent());",
      "return { symbol: await page.locator('h1').textContent(), price };",
    ].join('\n');
    const result = await exec.run(code, { symbol: '005930' }, site(), 30_000, never);
    assert.deepEqual(
      result.ok && result.output,
      { symbol: '005930', price: 71000 },
      JSON.stringify(result),
    );
    assert.equal(
      (await chromium.openUrls()).some((u) => u.includes('/q/')),
      false,
    );
  });

  test('허용 출처 밖으로의 이동은 막힌다', async () => {
    const code = "await page.goto('http://127.0.0.2:9/');\nreturn { ok: true };";
    const result = await exec.run(code, {}, site(), 30_000, never);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.kind, 'code');
  });

  test('site.loginNeeded는 login, 규칙에 걸린 코드는 돌리지 않는다', async () => {
    const login = await exec.run("site.loginNeeded('로그인 화면')", {}, site(), 30_000, never);
    assert.deepEqual(
      [login.ok, !login.ok && login.kind, !login.ok && login.error],
      [false, 'login', '로그인 화면'],
    );
    const blocked = await exec.run('return { env: process.env }', {}, site(), 30_000, never);
    assert.deepEqual([blocked.ok, !blocked.ok && blocked.ms], [false, 0]);
  });

  test('시간을 넘기면 끄고 연 탭을 닫는다', async () => {
    const code = "await page.goto(site.origin + '/q/slow');\nawait new Promise(() => {});";
    const result = await exec.run(code, {}, site(), 4_000, never);
    assert.deepEqual([result.ok, !result.ok && result.kind], [false, 'timeout']);
    await new Promise((done) => setTimeout(done, 300));
    assert.equal(
      (await chromium.openUrls()).some((u) => u.includes('/q/slow')),
      false,
    );
  });

  const write = { mode: 'write' as const, dryRun: false };
  const fill = [
    "await page.goto(site.origin + '/form');",
    "await page.getByRole('textbox', { name: '제목' }).fill(input.t);",
  ];

  test('읽기 도구는 폼 제출(POST 이동)이 막힌다', async () => {
    posts = 0;
    const code = [
      ...fill,
      "await page.getByRole('button', { name: '게시' }).click();",
      'await page.waitForTimeout(500);',
      'return {};',
    ].join('\n');
    await exec.run(code, { t: '안녕' }, site(), 30_000, never);
    assert.equal(posts, 0);
  });

  test('쓰기 도구의 마른 실행은 commit 앞에서 멈추고 아무것도 보내지 않는다', async () => {
    posts = 0;
    const code = [
      ...fill,
      "await site.commit(page.getByRole('button', { name: '게시' }));",
      'return { done: true };',
    ].join('\n');
    const result = await exec.run(code, { t: '안녕' }, site(), 30_000, never, {
      mode: 'write',
      dryRun: true,
    });
    assert.deepEqual(
      [result.ok, result.ok && result.dry, posts],
      [true, true, 0],
      JSON.stringify(result),
    );
  });

  test('쓰기 도구는 commit 전의 POST를 막고, commit에서 한 번만 보낸 뒤 결과를 읽는다', async () => {
    posts = 0;
    const code = [
      ...fill,
      "await page.getByRole('button', { name: '미리 보내기' }).click();",
      'await page.waitForTimeout(300);',
      "await site.commit(page.getByRole('button', { name: '게시' }));",
      "await page.getByRole('heading', { name: '올렸어요' }).waitFor();",
      "return { said: await page.locator('h1').textContent() };",
    ].join('\n');
    const result = await exec.run(code, { t: '안녕' }, site(), 30_000, never, write);
    assert.deepEqual(result.ok && result.output, { said: '올렸어요' }, JSON.stringify(result));
    assert.equal(posts, 1, 'commit 전의 클릭은 막히고 commit 한 번만');
  });

  test('commit 대상이 둘이면 누르지 않고 실패, 마른 실행에서도 실패', async () => {
    posts = 0;
    const code =
      "await page.goto(site.origin + '/twice');\nawait site.commit(page.getByRole('button', { name: '게시' }));\nreturn {};";
    for (const dryRun of [false, true]) {
      const result = await exec.run(code, {}, site(), 30_000, never, { mode: 'write', dryRun });
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.match(!result.ok ? result.error : '', /하나가 아니에요 \(2개\)/);
    }
    assert.equal(posts, 0);
  });
});
