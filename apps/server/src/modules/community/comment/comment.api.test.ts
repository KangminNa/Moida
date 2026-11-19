import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';

// 커뮤니티 댓글 (스토어 3-1b): 회원이 보이는 글에 달고, 쓴 회원만 지운다. 글 하나를 읽으면 보이는 댓글이 함께 온다.
// 쓰기 규칙: 가입 직후 대기 · 시간당 30개 · 링크 2개 · 같은 글의 같은 본문

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let site: CommunitySite;
let writer: TestUser;
let topicId = '';
const mark = randomUUID().slice(0, 8);

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

function comment(as: TestUser, body: string, topic = topicId, requestId = randomUUID()) {
  return site.write(as, 'POST', `/api/community/topics/${topic}/comments`, { requestId, body });
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  site = await CommunitySite.open(api, owner, `comments-${mark}`);
  writer = await site.member('topic_owner', '글주인');
  const topic = await site.write(writer, 'POST', '/api/community/topics', {
    requestId: randomUUID(),
    title: '댓글 받을 글',
    body: '여기에 달아 주세요',
  });
  topicId = String(ok(topic, 201).id);
});
after(() => api.close());

describe('댓글', () => {
  test('달면 글에 함께 보이고(내 댓글이면 version), 목록의 댓글 수가 오른다', async () => {
    const reader = await site.member('reader_one', '읽는이');
    const saved = ok(await comment(reader, '좋은 글이에요'), 201);
    const topic = ok(await site.at(`/api/community/topics/${topicId}`, { as: reader }));
    const mine = (topic.comments as Json[]).find((c) => c.id === saved.id) as Json;
    assert.deepEqual(mine.author, { nickname: '읽는이' });
    assert.equal(mine.mine, true);
    assert.equal(mine.version, 1);
    const other = (ok(await site.at(`/api/community/topics/${topicId}`)).comments as Json[]).find(
      (c) => c.id === saved.id,
    ) as Json;
    assert.equal(other.mine, false);
    assert.equal('version' in other, false);
    const list = ok(await site.at('/api/community/topics'));
    const line = (list.topics as Json[]).find((t) => t.id === topicId) as Json;
    assert.ok(Number(line.comments) >= 1);
  });

  test('방문자 401, 없는 글 · 지운 글에는 404, 링크 3개는 422, 같은 requestId는 하나', async () => {
    const res = await site.at(`/api/community/topics/${topicId}/comments`, {
      method: 'POST',
      body: { requestId: randomUUID(), body: '방문자' },
    });
    assert.equal(res.status, 401);
    const someone = await site.member('commenter_x', '댓글러');
    assert.equal((await comment(someone, '없는 글', randomUUID())).status, 404);
    assert.match(
      (await comment(someone, 'https://a.example https://b.example https://c.example')).text,
      /링크는 2개까지/,
    );
    const id = randomUUID();
    const first = ok(await comment(someone, '한 번만', topicId, id), 201);
    assert.equal(ok(await comment(someone, '한 번만', topicId, id), 201).id, first.id);
    const gone = ok(
      await site.write(writer, 'POST', '/api/community/topics', {
        requestId: randomUUID(),
        title: '지울 글',
        body: '댓글 못 달게',
      }),
      201,
    );
    await site.write(writer, 'DELETE', `/api/community/topics/${gone.id}`, {
      version: gone.version,
    });
    assert.equal((await comment(someone, '지운 글에', String(gone.id))).status, 404);
  });

  test('지우기: 쓴 회원만(남은 403), 지우면 글에서 빠진다', async () => {
    const author = await site.member('comment_del', '지울이');
    const saved = ok(await comment(author, '곧 지울 댓글'), 201);
    const del = (as: TestUser) =>
      site.write(as, 'DELETE', `/api/community/comments/${saved.id}`, { version: saved.version });
    assert.equal((await del(writer)).status, 403);
    assert.equal((await del(author)).status, 204);
    const topic = ok(await site.at(`/api/community/topics/${topicId}`));
    assert.equal(
      (topic.comments as Json[]).some((c) => c.id === saved.id),
      false,
    );
  });

  test('한 시간에 30개까지 (429), 같은 글에 같은 본문은 다시 못 단다 (409)', async () => {
    const chatty = await site.member('chatty_one', '수다쟁이');
    for (let i = 0; i < 30; i += 1)
      assert.equal((await comment(chatty, `댓글 ${i}`)).status, 201, `${i}번째`);
    assert.equal((await comment(chatty, '서른한 번째')).status, 429);
    const echo = await site.member('echo_one', '메아리');
    assert.equal((await comment(echo, '같은 말')).status, 201);
    assert.equal((await comment(echo, '같은   말')).status, 409);
  });

  test('가입하고 5분이 지나야 단다 (422)', async () => {
    const fresh = await site.member('fresh_two', '새내기둘', false);
    assert.match((await comment(fresh, '바로 달기')).text, /가입하고 5분 뒤부터/);
  });
});
