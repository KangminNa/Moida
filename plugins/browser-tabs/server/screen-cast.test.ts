import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FakeCdp } from './fake-cdp';
import { BrowserScreenGateway } from './screen.gateway';
import { ScreenCastGateway } from './screen-cast.gateway';

// 서버 브라우저 화면 흘려보내기 (2026-11-26): 탭에 한 번 붙어 Chrome이 보내는 그림을 받아 두고,
// "이 번호보다 새 그림"을 물으면 바로 · 없으면 기다렸다 답한다. 클릭은 같은 연결로 보낸다

let cdp: FakeCdp;
let cast: ScreenCastGateway;
const A = 'A'.repeat(32);
const D = 'D'.repeat(32);
const text = (image: string) => Buffer.from(image, 'base64').toString();
const opened = (tab: string) =>
  cdp.calls.filter((c) => c.tab === tab && c.method === 'Page.startScreencast').length;

before(async () => {
  cdp = await FakeCdp.start();
  cast = new ScreenCastGateway(new BrowserScreenGateway('127.0.0.1', cdp.port));
});
after(() => cdp.close());

describe('ScreenCastGateway', () => {
  test('처음 묻으면 붙어 흘려보내기를 시작하고 첫 그림을 준다 (번호 · 크기는 CSS 픽셀)', async () => {
    const frame = await cast.frame(A, 0, 2_000);
    assert.ok(frame);
    assert.equal(frame.seq, 1);
    assert.equal(text(frame.image), 'frame-1');
    assert.deepEqual([frame.width, frame.height], [1280, 720]);
    const start = cdp.calls.find((c) => c.method === 'Page.startScreencast');
    assert.equal(start?.params.format, 'jpeg');
    const acked = () => cdp.calls.some((c) => c.method === 'Page.screencastFrameAck');
    for (let i = 0; i < 50 && !acked(); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(acked(), '받았다고 알린다');
  });

  test('새 그림이 없으면 기다렸다 null (화면 그대로), 다시 붙지 않는다', async () => {
    const started = Date.now();
    assert.equal(await cast.frame(A, 1, 300), null);
    assert.ok(Date.now() - started >= 250);
    assert.equal(opened(A), 1, '같은 탭은 한 연결');
  });

  test('클릭은 붙은 연결로 보내고, 바뀐 그림을 기다리던 쪽이 바로 받는다', async () => {
    const waiting = cast.frame(A, 1, 4_000);
    const started = Date.now();
    await cast.control(A, { type: 'click', x: 10, y: 20, count: 1 });
    const frame = await waiting;
    assert.equal(frame?.seq, 2);
    assert.ok(Date.now() - started < 2_000, '기다림이 끝까지 가지 않는다');
    const clicks = cdp.calls.filter((c) => c.tab === A && c.method === 'Input.dispatchMouseEvent');
    assert.equal(clicks.length, 3);
    assert.equal(opened(A), 1);
  });

  test('흘려보내기가 그림을 주지 않는 탭은 한 번 찍어 둔다', async () => {
    cdp.screencast = false;
    try {
      const frame = await cast.frame(D, 0, 3_000);
      assert.ok(frame);
      assert.equal(text(frame.image), 'jpeg');
      assert.ok(cdp.calls.some((c) => c.tab === D && c.method === 'Page.captureScreenshot'));
    } finally {
      cdp.screencast = true;
    }
  });

  test('붙지 않은 탭의 동작은 한 번 붙어서 보낸다 (예전 길)', async () => {
    const before = cdp.calls.length;
    // 닫힌 탭이면 예전 길이 "닫힌 탭"으로 거절한다
    await assert.rejects(
      cast.control('Q'.repeat(32), { type: 'key', key: 'Enter', mods: 0 }),
      /닫힌 탭/,
    );
    assert.equal(cdp.calls.length, before);
  });
});
