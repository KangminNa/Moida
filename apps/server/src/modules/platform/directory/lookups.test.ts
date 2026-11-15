import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { OwnerActor } from '../base/actor';
import { NotFound } from '../base/errors';
import { Lookups } from './lookups';

// 모듈 사이 읽기 (리팩토링 R3b): 종류마다 한 모듈이 등록하고, 묻는 쪽은 그 모듈을 가져오지 않는다.

describe('Lookups', () => {
  const owner = new OwnerActor('01a1a000-0000-7000-8000-000000000001', 'owner-1');
  const lookups = () => {
    const made = new Lookups();
    made.provide(
      'wiki',
      async (_actor, ids) =>
        new Map(ids.filter((id) => id !== 'hidden').map((id) => [id, `제목 ${id}`])),
    );
    return made;
  };

  test('볼 수 있는 것만 id → 제목으로 돌려준다', async () => {
    const seen = await lookups().visible('wiki', owner, ['a', 'hidden']);
    assert.deepEqual([...seen], [['a', '제목 a']]);
  });

  test('하나라도 볼 수 없으면 묻는 쪽의 문구로 NotFound', async () => {
    await assert.rejects(
      lookups().assertVisible('wiki', owner, ['a', 'hidden'], '찾을 수 없는 위키예요'),
      (e: unknown) => e instanceof NotFound && e.message === '찾을 수 없는 위키예요',
    );
    await lookups().assertVisible('wiki', owner, ['a'], '찾을 수 없는 위키예요');
  });

  test('빈 목록은 묻지 않고, 등록 안 된 종류 · 두 번 등록은 오류 (서버 구성이 틀렸다)', async () => {
    const made = new Lookups();
    let asked = 0;
    made.provide('session', async () => {
      asked++;
      return new Map();
    });
    assert.equal((await made.visible('session', owner, [])).size, 0);
    assert.equal(asked, 0);
    await assert.rejects(made.visible('nothing', owner, ['x']), /등록한 모듈이 없어요/);
    assert.throws(() => made.provide('session', async () => new Map()), /이미 등록한/);
  });
});
