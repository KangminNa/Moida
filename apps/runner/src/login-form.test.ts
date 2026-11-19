import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { pause } from './backoff';
import { BrowserPages, type BrowserTab } from './browser-page';
import { BrowserStop } from './browser-stop';
import { LoginForm, LoginFormProblemOnPage } from './login-form';
import { LoginFormProblem, LoginFormRef } from './login-form-ref';
import { TestChromium } from './testing/test-chromium';

// 로그인 카드 (2026-11-19): AI가 알려 준 로그인 칸의 모양(믿지 않는 입력)과, 관리자가 넣은 값을 AI 없이 그 칸에 넣고 누르기.
// 브라우저 쪽은 진짜 Chromium: 칸을 다시 찾고(하나뿐 · 종류 · 보임), 출처가 다르면 넣지 않고, 넣은 값이 사이트로 가는지 본다.

const FORM = {
  fields: [
    { kind: 'id', role: 'textbox', name: '아이디' },
    { kind: 'password', role: 'textbox', name: '비밀번호' },
  ],
  submit: { role: 'button', name: '로그인' },
};

describe('로그인 칸의 모양 (browser-stop.json의 form)', () => {
  test('종류 · 역할 · 이름만 받고, 틀리면 form만 버린다 (로그인 필요는 그대로)', () => {
    const stop = BrowserStop.of({ stop: 'login', page_url: 'https://a.example/login', form: FORM });
    assert.deepEqual(stop.form?.toJSON(), FORM);
    const wrong = BrowserStop.of({
      stop: 'login',
      page_url: 'https://a.example/login',
      form: { ...FORM, fields: [{ kind: 'card', role: 'textbox', name: '카드 번호' }] },
    });
    assert.deepEqual([wrong.kind, wrong.form], ['login', null]);
    assert.equal(BrowserStop.of({ stop: 'login', page_url: 'https://a.example/x' }).form, null);
  });

  test('칸은 1~3개, 같은 종류 둘 · 틀린 역할 · 빈 이름은 받지 않는다', () => {
    for (const form of [
      { ...FORM, fields: [] },
      { ...FORM, fields: [FORM.fields[0], FORM.fields[0]] },
      { ...FORM, fields: [{ kind: 'id', role: 'Text Box!', name: '아이디' }] },
      { ...FORM, submit: { role: 'button', name: '' } },
    ])
      assert.throws(() => LoginFormRef.parse(form), LoginFormProblem, JSON.stringify(form));
  });

  test('넣어도 되는 출처: https와 이 컴퓨터의 http만', () => {
    assert.equal(LoginForm.safeOrigin('https://nid.example.com/login'), true);
    assert.equal(LoginForm.safeOrigin('http://127.0.0.1:3000/login'), true);
    assert.equal(LoginForm.safeOrigin('http://shop.example/login'), false);
    assert.equal(LoginForm.safeOrigin('javascript:alert(1)'), false);
  });
});

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>로그인</title></head><body>
<form action="/session" method="post">
  <label>아이디 <input name="id" autocomplete="username"></label>
  <label>비밀번호 <input name="pw" type="password"></label>
  <label>별명 <input name="nick"></label>
  <button type="submit">로그인</button>
</form>
<label>두 번 <input name="a"></label><label>두 번 <input name="b"></label>
</body></html>`;

describe('로그인 칸에 넣고 누르기 (실제 Chromium)', { skip: TestChromium.skip }, () => {
  let chromium: TestChromium;
  let site: Server;
  let url: string;
  let pages: BrowserPages;
  const posts: string[] = [];
  const signal = () => AbortSignal.timeout(20_000);

  before(async () => {
    site = createServer((req, res) => {
      const html = (body: string) =>
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
      if (req.method !== 'POST') return html(PAGE);
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        posts.push(body);
        html('<title>로그인됨</title><p>어서 오세요</p>');
      });
    });
    await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
    url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
    chromium = await TestChromium.start();
    pages = new BrowserPages(chromium.endpoint);
  });

  after(async () => {
    await chromium.stop();
    site.closeAllConnections();
    site.close();
  });

  async function opened(): Promise<BrowserTab> {
    const tab = await pages.open(`${url}/login`, signal());
    await pause(800);
    return tab;
  }

  test('칸을 다시 찾아 넣고 로그인 단추를 누른다: 값은 사이트로만 간다', async () => {
    const tab = await opened();
    const form = LoginFormRef.parse(FORM) as LoginFormRef;
    await LoginForm.check(tab, form, signal());
    const values = new Map([
      ['id', 'me@example.com'],
      ['password', 'p4ss word!'],
    ]);
    const after = await LoginForm.submit(tab, url, form, values, signal());
    assert.equal(after, `${url}/session`);
    assert.equal(posts.at(-1), 'id=me%40example.com&pw=p4ss+word%21&nick=');
  });

  test('종류가 다르거나(비밀번호가 아닌 칸) · 여럿이거나 · 없으면 넣지 않는다', async () => {
    const tab = await opened();
    const before = posts.length;
    for (const [field, problem] of [
      [{ kind: 'password', role: 'textbox', name: '별명' }, /종류가 맞지 않아요/],
      [{ kind: 'id', role: 'textbox', name: '비밀번호' }, /종류가 맞지 않아요/],
      [{ kind: 'id', role: 'textbox', name: '두 번' }, /여럿이에요/],
      [{ kind: 'id', role: 'textbox', name: '전화번호' }, /찾지 못했어요/],
    ] as const) {
      const form = LoginFormRef.parse({ ...FORM, fields: [field] }) as LoginFormRef;
      await assert.rejects(LoginForm.check(tab, form, signal()), (e: Error) => {
        assert.ok(e instanceof LoginFormProblemOnPage);
        assert.match(e.message, problem);
        return true;
      });
    }
    assert.equal(posts.length, before);
  });

  test('탭의 출처가 로그인 화면의 출처가 아니면 넣지 않는다', async () => {
    const tab = await opened();
    const before = posts.length;
    const form = LoginFormRef.parse(FORM) as LoginFormRef;
    const values = new Map([
      ['id', 'me'],
      ['password', 'secret'],
    ]);
    await assert.rejects(
      LoginForm.submit(tab, 'https://other.example', form, values, signal()),
      /로그인 화면이 아닌 곳/,
    );
    assert.equal(posts.length, before);
  });
});
