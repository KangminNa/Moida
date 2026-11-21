import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type BrowserPages,
  type BrowserTab,
  ButtonProblem,
  ButtonRef,
  HeldButton,
  PressResult,
} from './browser-page';
import { type PressCalls, PressOrder } from './press-calls';
import { PressLoop } from './press-loop';
import type { RunEvent } from './progress';

// 승인된 누르기 계획의 러너 쪽 (F2, 2026-11-21): AI가 요청한 버튼을 다시 찾아 같은 버튼 · 같은 주소일 때만 누른다.
// 브라우저 · 서버 없이 도는 부품 시험 (BrowserPages · PressCalls를 흉내 낸다)

const PAGE = 'https://map.example/place/1';
const tab = { id: 'T1', url: PAGE, title: '장소', socket: '' } as unknown as BrowserTab;
const order = (id: string, url = PAGE) =>
  new PressOrder(id, 2, url, new ButtonRef('button', '저장', 0), `${id} 저장`);

/** 줄 선 요청을 하나씩 내주고, 남긴 결과를 모은다. 다 내주면 고리를 멈춘다 */
function calls(orders: PressOrder[], done: () => void) {
  const saved: { id: string; outcome: string; reason: string | null; held: boolean }[] = [];
  const fake = {
    nextPress: async () => {
      const next = orders.shift() ?? null;
      if (next === null) done();
      return next;
    },
    savePress: async (_task: string, o: PressOrder, r: PressResult, held: HeldButton | null) => {
      saved.push({ id: o.id, outcome: r.outcome, reason: r.reason, held: held !== null });
    },
  };
  return { calls: fake as unknown as PressCalls, saved };
}

function pages(opts: { heldUrl?: string; missing?: boolean } = {}) {
  const pressed: string[] = [];
  const fake = {
    hold: async (t: BrowserTab, button: ButtonRef) => {
      if (opts.missing) throw new ButtonProblem(`버튼이 없어요: ${button.role} "${button.name}"`);
      return new HeldButton(
        t,
        opts.heldUrl ?? PAGE,
        button,
        { x: 1, y: 2, width: 3, height: 4 },
        'f'.repeat(64),
        'aW1n',
      );
    },
    press: async (held: { tabId: string; fingerprint: string }) => {
      pressed.push(held.tabId);
      return new PressResult('clicked', null, `${PAGE}?saved=1`, 'aW1n');
    },
  };
  return { pages: fake as unknown as BrowserPages, pressed };
}

async function run(
  orders: PressOrder[],
  page: ReturnType<typeof pages>,
  tabOf: (url: string) => BrowserTab | null = () => tab,
) {
  const lines: string[] = [];
  const halt = new AbortController();
  const fake = calls(orders, () => halt.abort());
  const loop = new PressLoop(
    fake.calls,
    page.pages,
    'task-1',
    async (u) => tabOf(u),
    (e: RunEvent) => lines.push(e.body),
  );
  loop.start(halt.signal);
  await new Promise((resolve) => halt.signal.addEventListener('abort', resolve));
  await loop.stop();
  return { saved: fake.saved, lines };
}

describe('누르기 고리 (승인된 계획)', () => {
  test('요청마다 다시 찾아 누르고 결과를 남긴다 (다시 찾은 버튼 · 화면과 함께)', async () => {
    const page = pages();
    const { saved, lines } = await run([order('c1'), order('c2')], page);
    assert.deepEqual(
      saved.map((s) => [s.id, s.outcome, s.held]),
      [
        ['c1', 'clicked', true],
        ['c2', 'clicked', true],
      ],
    );
    assert.deepEqual(page.pressed, ['T1', 'T1']);
    assert.match(lines[0] ?? '', /^눌렀어요: c1 저장 \(map\.example\)/);
  });

  test('탭이 없거나 · 버튼을 못 찾거나 · 주소가 바뀌었으면 누르지 않고 까닭을 남긴다', async () => {
    const none = await run([order('c1')], pages(), () => null);
    assert.deepEqual(
      none.saved.map((s) => [s.outcome, s.reason, s.held]),
      [['changed', '그 주소의 탭을 찾지 못했어요', false]],
    );
    const missing = pages({ missing: true });
    const lost = await run([order('c2')], missing);
    assert.match(lost.saved[0]?.reason ?? '', /버튼이 없어요/);
    assert.deepEqual(missing.pressed, []);
    const moved = pages({ heldUrl: 'https://map.example/place/2' });
    const other = await run([order('c3')], moved);
    assert.deepEqual(
      other.saved.map((s) => [s.outcome, s.reason, s.held]),
      [['changed', '요청한 뒤 주소가 바뀌었어요', true]],
    );
    assert.deepEqual(moved.pressed, [], '다른 주소에서는 누르지 않는다');
  });
});
