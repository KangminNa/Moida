import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { WorkScheduler } from './work-scheduler';

// 일꾼이 깰 시각을 잡는 타이머 (리팩토링 2단계). 가짜 시계로 본다.

describe('WorkScheduler', () => {
  const at = (ms: number) => new Date(Date.now() + ms);

  test('키마다 타이머 하나: 새로 잡으면 앞의 것을 바꾸고, null이면 끈다', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const scheduler = new WorkScheduler();
    const runs: string[] = [];
    scheduler.at('a', at(100), () => runs.push('a1'));
    scheduler.at('a', at(300), () => runs.push('a2'));
    scheduler.at('b', at(200), () => runs.push('b'));
    t.mock.timers.tick(250);
    assert.deepEqual(runs, ['b'], '먼저 잡은 a는 바뀌었다');
    scheduler.at('a', null, () => runs.push('a3'));
    t.mock.timers.tick(1_000);
    assert.deepEqual(runs, ['b'], 'null이면 꺼진다');
  });

  test('지난 시각은 다음 차례에 바로 부른다', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const scheduler = new WorkScheduler();
    let ran = 0;
    scheduler.at('past', at(-5_000), () => ran++);
    assert.equal(ran, 0, '부르는 자리에서 바로 돌지 않는다');
    t.mock.timers.tick(0);
    assert.equal(ran, 1);
  });

  test('setTimeout 한도(약 24.8일)를 넘는 시각은 한도에서 깨어 다시 잰다', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const scheduler = new WorkScheduler();
    const DAY = 86_400_000;
    let ran = 0;
    scheduler.at('far', at(40 * DAY), () => ran++);
    t.mock.timers.tick(25 * DAY);
    assert.equal(ran, 0, '한도에서 깨어도 아직 때가 아니다');
    t.mock.timers.tick(15 * DAY);
    assert.equal(ran, 1);
  });

  test('멈추면 걸린 타이머를 끄고 더 잡지 않는다', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const scheduler = new WorkScheduler();
    const run = mock.fn();
    scheduler.at('a', at(100), run);
    scheduler.stop();
    scheduler.at('b', at(100), run);
    t.mock.timers.tick(1_000);
    assert.equal(run.mock.callCount(), 0);
  });
});
