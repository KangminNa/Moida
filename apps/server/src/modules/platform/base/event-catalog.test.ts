import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { DomainEvent } from './event';
import { EventCatalog } from './event-catalog';

// 이벤트 목록 (리팩토링 R3c): 모르는 주제 · 어긋난 칸을 내보내기 전에, 틀린 구독 무늬를 시작할 때 잡는다.

const SPACE = '01a1a000-0000-7000-8000-000000000001';
const event = (name: string, data: Record<string, unknown>) =>
  new DomainEvent(name, 1, SPACE, data);

EventCatalog.define('probe', {
  topics: {
    'probe.thing.saved': { fields: ['thingId', 'title', 'error?'] },
    'probe.thing.gone': { fields: ['thingId'] },
  },
});

describe('EventCatalog', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  test('목록대로의 칸이면 통과, 없어도 되는 칸(?)은 빠져도 된다', () => {
    EventCatalog.check(event('probe.thing.saved', { thingId: 'a', title: 't' }));
    EventCatalog.check(event('probe.thing.saved', { thingId: 'a', title: 't', error: 'x' }));
  });

  test('목록에 없는 주제는 오류, 플러그인 주제는 플러그인의 목록 파일이 따로 막아 넘긴다', () => {
    assert.throws(() => EventCatalog.check(event('probe.thing.typo', {})), /목록에 없는 주제/);
    EventCatalog.check(event('plugin.anything.done', { whatever: 1 }));
  });

  test('칸이 어긋나면 개발 · 시험은 오류, 운영은 경고만 (서비스를 멈추지 않는다)', () => {
    assert.throws(
      () => EventCatalog.check(event('probe.thing.saved', { thingId: 'a', extra: 1 })),
      /빠진 칸 title · 목록에 없는 칸 extra/,
    );
    process.env.NODE_ENV = 'production';
    EventCatalog.check(event('probe.thing.saved', { thingId: 'a', extra: 1 }));
  });

  test('주제는 모듈 이름으로 시작하고, 다른 모듈의 주제를 등록하면 오류 (같은 모듈은 다시 등록할 수 있다)', () => {
    assert.throws(
      () => EventCatalog.define('other', { topics: { 'probe.thing.saved': { fields: [] } } }),
      /다른 모듈의 주제/,
    );
    EventCatalog.define('probe', { topics: { 'probe.thing.gone': { fields: ['thingId'] } } });
  });

  test('구독 무늬: 주제 · 앞부분.* · * · 플러그인 무늬는 맞고, 오타는 걸린다', () => {
    assert.deepEqual(
      EventCatalog.unknownPatterns([
        'probe.thing.saved',
        'probe.thing.*',
        '*',
        'plugin.x.y',
        'probe.thng.saved',
        'probe.other.*',
      ]),
      ['probe.thng.saved', 'probe.other.*'],
    );
  });
});
