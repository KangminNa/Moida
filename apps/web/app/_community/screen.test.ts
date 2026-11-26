import assert from 'node:assert/strict';
import { test } from 'node:test';
import { communityOf, topicOf, topicsOf } from './screen.ts';
import type { MemberMe, TopicDetail } from './types.ts';

const OPEN = { base: '/', open: true, here: '/t/a1' };
const PREVIEW = { base: '/town/~tk', open: false, here: '/town/~tk/t/a1' };
const me = {
  member: {
    id: 'm1',
    loginId: 'reader',
    email: null,
    nickname: '읽는사람',
    joinedAt: '2026-11-19T00:00:00.000Z',
    writableAt: '2026-11-19T00:05:00.000Z',
    blockedUntil: null,
    version: 1,
  },
  csrf: 'secret',
} satisfies MemberMe;
const topic = {
  id: 'a1',
  title: '첫 글',
  body: '[밖](https://example.com)',
  author: { nickname: '쓴사람' },
  createdAt: '2026-11-19T01:00:00.000Z',
  editedAt: null,
  mine: false,
  comments: [
    {
      id: 'c1',
      body: '<b>댓글</b>',
      author: { nickname: '읽는사람' },
      createdAt: '2026-11-19T02:00:00.000Z',
      mine: true,
      version: 1,
    },
    {
      id: 'c2',
      body: '남의 댓글',
      author: { nickname: '다른사람' },
      createdAt: '2026-11-19T03:00:00.000Z',
      mine: false,
    },
  ],
} satisfies TopicDetail;

test('회원 링크: 앱 도메인에서만, 닉네임만 싣고 아이디 · 확인 값은 싣지 않는다', () => {
  const open = communityOf(OPEN, me);
  assert.deepEqual(open, {
    open: true,
    member: { nickname: '읽는사람' },
    joinUrl: '/_/join',
    loginUrl: '/_/login?return=%2Ft%2Fa1',
    meUrl: '/_/me',
    writeUrl: '/_/write',
  });
  assert.doesNotMatch(JSON.stringify(open), /reader|secret|m1/);
  assert.deepEqual(communityOf(PREVIEW, me), {
    open: false,
    member: null,
    joinUrl: null,
    loginUrl: null,
    meUrl: null,
    writeUrl: null,
  });
});

test('글 목록: 앱 안 주소와 다음 쪽', () => {
  const list = {
    topics: [
      {
        id: 'a1',
        title: '첫 글',
        excerpt: '앞부분',
        author: { nickname: '쓴사람' },
        comments: 2,
        createdAt: '2026-11-19T01:00:00.000Z',
        editedAt: null,
      },
    ],
    nextCursor: 'a1',
  };
  const open = topicsOf(list, OPEN);
  assert.equal(open.topics[0]?.url, '/t/a1');
  assert.deepEqual(open.more, { url: '/?cursor=a1' });
  const preview = topicsOf(list, PREVIEW);
  assert.equal(preview.topics[0]?.url, '/town/~tk/t/a1');
  assert.deepEqual(preview.more, { url: '/town/~tk?cursor=a1' });
  assert.deepEqual(topicsOf(null, OPEN), { topics: [], more: null });
});

test('글 하나: 회원 글의 링크는 nofollow ugc, 남의 글 · 댓글은 신고, 내 글만 고치기', () => {
  const shown = topicOf(topic, OPEN);
  assert.match(shown.html, /rel="nofollow ugc noopener noreferrer"/);
  assert.equal(shown.editUrl, null);
  assert.equal(shown.reportUrl, '/_/report?topic=a1');
  assert.equal(shown.commentUrl, '/_/comment/a1');
  assert.deepEqual(
    shown.comments.map((c) => [c.mine, c.reportUrl]),
    [
      [true, null],
      [false, '/_/report?comment=c2&topic=a1'],
    ],
  );
  // 댓글은 글자 그대로 (템플릿의 {{body}}가 이스케이프한다)
  assert.equal(shown.comments[0]?.body, '<b>댓글</b>');

  const mine = topicOf({ ...topic, mine: true, version: 3 }, OPEN);
  assert.deepEqual([mine.editUrl, mine.reportUrl], ['/_/write/a1', null]);

  const preview = topicOf(topic, PREVIEW);
  assert.deepEqual(
    [preview.editUrl, preview.commentUrl, preview.reportUrl, preview.comments[1]?.reportUrl],
    [null, null, null, null],
  );
});
