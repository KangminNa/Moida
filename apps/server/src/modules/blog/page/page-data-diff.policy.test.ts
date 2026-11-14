import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PageDataDiff } from './page-data-diff.policy';

// 자라는 페이지의 바뀐 점: data.json 두 판을 잎까지 펼쳐 비교한다.

const rows = (before: unknown, after: unknown) =>
  PageDataDiff.between(before, after).changes.map((c) => [c.path, c.kind, c.before, c.after]);

describe('PageDataDiff', () => {
  test('더해진 것 · 바뀐 것 · 빠진 것을 경로와 함께', () => {
    assert.deepEqual(
      rows(
        { city: '서울', places: [{ name: '성수' }, { name: '연남' }], old: true },
        { city: '부산', places: [{ name: '성수' }, { name: '연남' }, { name: '해운대' }] },
      ),
      [
        ['city', 'changed', '"서울"', '"부산"'],
        ['places[2].name', 'added', null, '"해운대"'],
        ['old', 'removed', 'true', null],
      ],
    );
  });

  test('첫 판(앞 판에 data.json 없음)은 모두 더해진 것, 같으면 없다', () => {
    assert.deepEqual(rows(undefined, { a: 1, b: [] }), [
      ['a', 'added', null, '1'],
      ['b', 'added', null, '[]'],
    ]);
    assert.deepEqual(rows({ a: 1 }, { a: 1 }), []);
    assert.deepEqual(rows(null, 3), [['(전체)', 'changed', 'null', '3']], 'null은 값이다');
  });

  test('보일 만큼만: 100개까지, 값은 200자까지', () => {
    const many = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`k${i}`, i]));
    const diff = PageDataDiff.between({}, many);
    assert.equal(diff.changes.length, PageDataDiff.CHANGES_MAX);
    assert.equal(diff.truncated, true);
    const [long] = PageDataDiff.between({ t: 'a' }, { t: 'b'.repeat(500) }).changes;
    assert.equal(long?.after?.length, 200);
  });
});
