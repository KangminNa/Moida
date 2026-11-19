import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import type { Agent } from '../agent/agent';
import { TaskRefs } from './task-refs.policy';

// 대화의 참조 (2026-11-15 B): 확인 · 읽기 허락 · 비공개 규칙 · 위임. DB 없이 돈다
const WIKI = '0190a000-0000-7000-8000-000000000001';
const POST = '0190a000-0000-7000-8000-000000000002';
const OUTPUT = '0190a000-0000-7000-8000-000000000003';
const PAGE = '0190a000-0000-7000-8000-000000000004';
const FOUND = [
  { kind: 'wiki', id: WIKI, title: '비공개 위키', visibility: 'private', url: null },
  { kind: 'post', id: POST, title: '공개한 글', visibility: 'published', url: null },
  { kind: 'output', id: OUTPUT, title: 'report.pdf', visibility: 'private', url: null },
  { kind: 'page', id: PAGE, title: '여행지도', visibility: 'private', url: null },
];
const agent = (name: string, scopes: string[], externalTools: string[] = []) =>
  ({ name, scopes, externalTools }) as unknown as Agent;
const pick = (kind: string, id: string | null, url: string | null = null) => ({
  kind,
  id,
  url,
  browser: false,
});

describe('참조 확인', () => {
  test('보관함의 줄로 제목 · 비공개를 적고, 같은 것은 한 번만. 주소는 그대로', () => {
    const refs = TaskRefs.resolve(
      [
        pick('wiki', WIKI),
        pick('wiki', WIKI),
        pick('post', POST),
        pick('url', null, 'https://example.com/a'),
      ],
      FOUND,
    );
    assert.deepEqual(
      refs.lines.map((l) => [l.kind, l.title, l.private]),
      [
        ['wiki', '비공개 위키', true],
        ['post', '공개한 글', false],
        ['url', 'https://example.com/a', false],
      ],
    );
    assert.deepEqual(refs.readIds, [WIKI, POST], '주소는 허락이 아니다');
    assert.deepEqual(TaskRefs.idsOf([pick('wiki', WIKI), pick('url', null, 'https://x.y')]), [
      WIKI,
    ]);
  });

  test('비공개 페이지는 넣지 못하고, 공개 페이지는 주소로 넘긴다', () => {
    assert.throws(() => TaskRefs.resolve([pick('page', PAGE)], FOUND), RuleViolation);
    const open = TaskRefs.resolve(
      [pick('page', PAGE)],
      [
        {
          kind: 'page',
          id: PAGE,
          title: '여행지도',
          visibility: 'public',
          url: 'https://b.log/pages/trip/',
        },
      ],
    );
    assert.equal(open.lines[0]?.url, 'https://b.log/pages/trip/');
  });

  test('없거나 종류가 다른 참조, 10개 넘는 참조는 RuleViolation', () => {
    assert.throws(() => TaskRefs.resolve([pick('session', WIKI)], FOUND), RuleViolation);
    assert.throws(
      () =>
        TaskRefs.resolve(
          Array.from({ length: 11 }, () => pick('wiki', WIKI)),
          FOUND,
        ),
      RuleViolation,
    );
  });
});

describe('비공개 참조와 받는 에이전트', () => {
  const refs = TaskRefs.resolve([pick('wiki', WIKI), pick('output', OUTPUT)], FOUND);

  test('브라우저 · 커넥터 에이전트는 비공개 참조를 받지 못한다. 공개만이면 받는다', () => {
    assert.throws(() => refs.assertFor(agent('브라우저 담당', ['browse'])), RuleViolation);
    assert.throws(() => refs.assertFor(agent('조사', ['read_public'], ['linear'])), RuleViolation);
    assert.doesNotThrow(() => refs.assertFor(agent('작가', ['read_public', 'write'])));
    const open = TaskRefs.resolve([pick('post', POST)], FOUND);
    assert.doesNotThrow(() => open.assertFor(agent('브라우저 담당', ['browse'])));
    assert.deepEqual(refs.outputs, [OUTPUT]);
  });

  test('위임은 위 작업의 참조 가운데서만, 고르지 않으면 넘기지 않는다', () => {
    const parent = TaskRefs.of(refs.payload);
    const worker = agent('작가', ['write']);
    assert.deepEqual(parent.handOn([WIKI], worker).readIds, [WIKI]);
    assert.equal(parent.handOn(null, worker).empty, true);
    assert.deepEqual(parent.handOn([], worker).payload, {});
    assert.throws(() => parent.handOn([POST], worker), RuleViolation, '위 작업에 없는 참조');
    assert.throws(() => parent.handOn([WIKI], agent('브라우저 담당', ['browse'])), RuleViolation);
    assert.throws(() => parent.handOn([OUTPUT], agent('제작', ['make'])), RuleViolation, '셸 담당');
    const open = TaskRefs.of(TaskRefs.resolve([pick('post', POST)], FOUND).payload);
    assert.deepEqual(open.handOn([POST], agent('제작', ['make'])).readIds, [POST], '공개는 넘긴다');
  });
});

describe('사진 (대화에 사진 넣기, 2026-11-19)', () => {
  const PHOTOS = [1, 2, 3, 4, 5].map((n) => `0190a000-0000-7000-8000-00000000010${n}`);
  const found = PHOTOS.map((id, i) => ({
    kind: 'output',
    id,
    title: `사진${i + 1}.png`,
    visibility: 'private',
    url: null,
  }));
  const all = [...FOUND, ...found];

  test('사진인 결과물에만 image, 위임해도 그대로 간다', () => {
    const refs = TaskRefs.resolve(
      [
        pick('output', PHOTOS[0] ?? ''),
        pick('output', OUTPUT),
        pick('url', null, 'https://a.example'),
      ],
      all,
      new Set([PHOTOS[0] ?? '']),
    );
    assert.deepEqual(
      refs.lines.map((l) => [l.title, l.image]),
      [
        ['사진1.png', true],
        ['report.pdf', false],
        ['https://a.example', false],
      ],
    );
    const handed = TaskRefs.of(refs.payload).handOn([PHOTOS[0] ?? ''], agent('작가', ['write']));
    assert.equal(handed.lines[0]?.image, true);
  });

  test('사진은 한 번에 4장까지 (같은 사진을 두 번 골라도 한 장)', () => {
    const images = new Set(PHOTOS);
    const four = PHOTOS.slice(0, 4).map((id) => pick('output', id));
    assert.equal(TaskRefs.resolve(four, all, images).lines.length, 4);
    assert.doesNotThrow(() =>
      TaskRefs.resolve([...four, pick('output', PHOTOS[0] ?? '')], all, images),
    );
    assert.throws(
      () =>
        TaskRefs.resolve(
          PHOTOS.map((id) => pick('output', id)),
          all,
          images,
        ),
      /사진은 한 번에 4장까지예요/,
    );
  });
});
