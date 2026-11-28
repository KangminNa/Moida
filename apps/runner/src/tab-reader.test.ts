import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type BrowserTabs, BrowserUnavailable, TabText, TabUnreadable } from './browser-tabs';
import { ToolRefused } from './mcp-client';
import type { MoidaServer } from './moida-server';
import { Redactor, RunLog } from './redactor';
import { TabReader } from './tab-reader';

// 탭 읽기 루프: 받은 주소를 읽어 남기고, 못 읽으면 이유를 남기고, 패키지가 꺼져 있으면 조용히 기다린다.

type Saved = { id: string; read: object };

function fakes(
  answers: (() => readonly { id: string; url: string; blank?: boolean; shot?: boolean }[])[],
  read: (url: string, proxy: string | null, shot: boolean) => TabText,
) {
  const saved: Saved[] = [];
  const stopper = new AbortController();
  const server = {
    async pendingTabs() {
      const next = answers.shift();
      if (!next) {
        stopper.abort();
        return [];
      }
      return next();
    },
    async saveTab(id: string, r: object) {
      saved.push({ id, read: r });
    },
  } as unknown as MoidaServer;
  const browser = {
    async read(url: string, _stop: AbortSignal, proxy: string | null, shot = false) {
      return read(url, proxy, shot);
    },
  } as unknown as BrowserTabs;
  return { saved, stopper, reader: new TabReader(server, browser, new RunLog(new Redactor([]))) };
}

describe('TabReader', () => {
  test('읽은 탭은 제목과 글자를, 못 읽은 탭은 이유를 남긴다', async () => {
    const { saved, stopper, reader } = fakes(
      [
        () => [
          { id: 'a', url: 'https://ok.example/x' },
          { id: 'b', url: 'https://bad.example/' },
        ],
      ],
      (url) => {
        if (url.includes('bad')) throw new TabUnreadable('30초 안에 다 뜨지 않았어요');
        return TabText.of('제목', '본문');
      },
    );
    await reader.run(stopper.signal);
    assert.deepEqual(saved, [
      { id: 'a', read: { title: '제목', body: '본문' } },
      { id: 'b', read: { error: '30초 안에 다 뜨지 않았어요' } },
    ]);
  });

  test('브라우저에 닿지 못하면 실패로 남기지 않는다 (요청은 그대로, 나중에 다시)', async () => {
    const { saved, stopper, reader } = fakes(
      [() => [{ id: 'a', url: 'https://ok.example/x' }]],
      () => {
        throw new BrowserUnavailable('브라우저(http://127.0.0.1:9222)에 닿지 못했어요');
      },
    );
    setTimeout(() => stopper.abort(), 50);
    await reader.run(stopper.signal);
    assert.deepEqual(saved, []);
  });

  test('패키지가 꺼져 있으면(도구 없음) 아무것도 남기지 않고 멈출 때까지 기다린다', async () => {
    const { saved, stopper, reader } = fakes(
      [
        () => {
          throw new ToolRefused('tool', 'browser_tab_pending 도구가 없어요');
        },
      ],
      () => TabText.of('', ''),
    );
    setTimeout(() => stopper.abort(), 50);
    await reader.run(stopper.signal);
    assert.deepEqual(saved, []);
  });

  test('제목과 글자는 서버 도구의 한도에 맞춰 자른다', () => {
    const text = TabText.of('가'.repeat(400), '나'.repeat(TabText.BODY_MAX + 10));
    assert.equal(text.title.length, TabText.TITLE_MAX);
    assert.equal(text.body.length, TabText.BODY_MAX);
  });

  test('일꾼의 읽기(blank)만 내부 주소를 막는 프록시로 읽고, 함께 읽는 탭은 한 프록시를 나눠 쓴다', async () => {
    const proxies: (string | null)[] = [];
    const { saved, stopper, reader } = fakes(
      [
        () => [
          { id: 'a', url: 'https://owner.example/', blank: false },
          { id: 'b', url: 'https://one.example/', blank: true },
          { id: 'c', url: 'https://two.example/', blank: true },
        ],
      ],
      (_url, proxy) => {
        proxies.push(proxy);
        return TabText.of('t', 'b');
      },
    );
    await reader.run(stopper.signal);
    assert.equal(saved.length, 3);
    assert.equal(proxies[0], null, '관리자의 읽기는 프록시 없이');
    assert.match(String(proxies[1]), /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(proxies[1], proxies[2], '한 프록시를 나눠 쓴다');
  });

  test('shot을 달라고 한 일꾼의 읽기는 그림을 base64로 함께 남기고, 일꾼의 글은 줄여 남긴다', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    const { saved, stopper, reader } = fakes(
      [() => [{ id: 'a', url: 'https://design.example/', blank: true, shot: true }]],
      (_url, _proxy, shot) =>
        TabText.of('디자인', '가'.repeat(TabReader.AGENT_BODY_MAX + 5)).withShot(
          shot ? jpeg : null,
        ),
    );
    await reader.run(stopper.signal);
    const read = saved[0]?.read as { body: string; shot?: string };
    assert.equal(read.shot, jpeg.toString('base64'));
    assert.equal(read.body.length, TabReader.AGENT_BODY_MAX);
  });
});
