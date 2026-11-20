import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { JobPool } from './job-pool';

// 러너의 자리: 동시에 도는 일의 수와 브라우저 작업 하나.

/** 밖에서 끝낼 수 있는 일 */
function work(): { promise: Promise<void>; finish: () => void } {
  let finish = () => {};
  const promise = new Promise<void>((done) => {
    finish = done;
  });
  return { promise, finish };
}

const tick = () => new Promise((done) => setImmediate(done));

describe('러너의 자리', () => {
  test('자리만큼 앉히고, 일이 끝나면 자리가 빈다', async () => {
    const pool = new JobPool(2);
    const [a, b] = [work(), work()];
    pool.add(a.promise);
    pool.add(b.promise);
    assert.equal(pool.free, 0);

    let vacant = false;
    const waiting = pool.vacancy(new AbortController().signal).then(() => {
      vacant = true;
    });
    await tick();
    assert.equal(vacant, false, '자리가 없으면 기다린다');
    a.finish();
    await waiting;
    assert.equal(pool.free, 1);
    b.finish();
    await pool.drain();
    assert.equal(pool.free, 2);
  });

  test('멈추라고 하면 자리가 없어도 기다리지 않는다', async () => {
    const pool = new JobPool(1);
    const a = work();
    pool.add(a.promise);
    const stop = new AbortController();
    const waiting = pool.vacancy(stop.signal);
    stop.abort();
    await waiting;
    assert.equal(pool.free, 0);
    a.finish();
    await pool.drain();
  });

  test('브라우저 작업이 도는 동안만 브라우저가 바쁘다', async () => {
    const pool = new JobPool(3);
    const [plain, browse] = [work(), work()];
    pool.add(plain.promise);
    assert.equal(pool.browserBusy, false);
    pool.add(browse.promise, true);
    assert.equal(pool.browserBusy, true);
    browse.finish();
    await tick();
    assert.equal(pool.browserBusy, false);
    plain.finish();
    await pool.drain();
  });
  test('자리 수를 바꾼다 (러너 메뉴의 값, 2026-11-20): 1~8로 맞추고, 줄여도 도는 일은 그대로', async () => {
    const pool = new JobPool(3);
    const [a, b] = [work(), work()];
    pool.add(a.promise);
    pool.add(b.promise);
    assert.equal(pool.resize(3), false, '같으면 그대로');
    assert.equal(pool.resize(1), true);
    assert.equal(pool.free, 0, '도는 일 둘은 그대로, 새로 빌리지 않는다');
    assert.equal(pool.resize(20), true);
    assert.equal(pool.size, 8, '상한 8');
    assert.equal(pool.free, 6);
    pool.resize(0);
    assert.equal(pool.size, 1, '하한 1');
    a.finish();
    b.finish();
    await pool.drain();
  });
});
