import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';

// 커뮤니티 신고 (스토어 3-1c): 회원이 보이는 글 · 댓글을 신고한다. 한 대상에 한 번, 내 것은 못 하고, 시간당 10개까지.
// 가림은 일꾼이 하므로 여기서는 신고를 받는 규칙만 본다 (가림 · 관리자 결정은 moderation.api.test)

type Json = Record<string, unknown>;

let api: ApiClient;
let site: CommunitySite;
let writer: TestUser;
let topicId = '';
const mark = randomUUID().slice(0, 8);

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

function report(as: TestUser, body: object): Promise<ApiResult> {
  return site.write(as, 'POST', '/api/community/reports', body);
}

before(async () => {
  api = await ApiClient.start();
  const owner = await api.signIn();
  site = await CommunitySite.open(api, owner, `reports-${mark}`);
  writer = await site.member('report_writer', '신고받는이');
  const topic = await site.write(writer, 'POST', '/api/community/topics', {
    requestId: randomUUID(),
    title: '신고 받을 글',
    body: '여기를 신고해 보세요',
  });
  topicId = String(ok(topic, 201).id);
});
after(() => api.close());

describe('신고', () => {
  test('회원이 글을 신고하면 201, 같은 글을 또 하면 409, 내 글은 422', async () => {
    const reporter = await site.member('reporter_one', '신고자하나');
    const saved = ok(await report(reporter, { topicId, reason: 'spam', note: '광고예요' }), 201);
    assert.equal(typeof saved.id, 'string');
    assert.deepEqual(Object.keys(saved).sort(), ['createdAt', 'id']);
    const again = await report(reporter, { topicId, reason: 'abuse' });
    assert.equal(again.status, 409, again.text);
    assert.match(again.text, /이미 신고했어요/);
    const mine = await report(writer, { topicId, reason: 'spam' });
    assert.equal(mine.status, 422, mine.text);
  });

  test('댓글도 신고하고, 대상은 하나만 · 까닭은 목록에서 · 메모는 500자까지', async () => {
    const reporter = await site.member('reporter_two', '신고자둘');
    const comment = ok(
      await site.write(writer, 'POST', `/api/community/topics/${topicId}/comments`, {
        requestId: randomUUID(),
        body: '신고 받을 댓글',
      }),
      201,
    );
    ok(await report(reporter, { commentId: comment.id, reason: 'privacy' }), 201);
    assert.equal((await report(reporter, { reason: 'spam' })).status, 400);
    assert.equal(
      (await report(reporter, { topicId, commentId: comment.id, reason: 'spam' })).status,
      400,
    );
    assert.equal((await report(reporter, { topicId, reason: 'boring' })).status, 422);
    assert.equal(
      (await report(reporter, { topicId, reason: 'other', note: '가'.repeat(501) })).status,
      422,
    );
  });

  test('방문자 401, 없는 글 · 지운 글 404, 기본 도메인에서는 없는 주소', async () => {
    const visitor = await site.at('/api/community/reports', {
      method: 'POST',
      body: { topicId, reason: 'spam' },
    });
    assert.equal(visitor.status, 401);
    const reporter = await site.member('reporter_three', '신고자셋');
    assert.equal((await report(reporter, { topicId: randomUUID(), reason: 'spam' })).status, 404);
    const gone = ok(
      await site.write(writer, 'POST', '/api/community/topics', {
        requestId: randomUUID(),
        title: '지운 글',
        body: '지운 뒤 신고',
      }),
      201,
    );
    const deleted = await site.write(writer, 'DELETE', `/api/community/topics/${gone.id}`, {
      version: gone.version,
    });
    assert.equal(deleted.status, 204, deleted.text);
    assert.equal((await report(reporter, { topicId: gone.id, reason: 'spam' })).status, 404);
    const main = await api.request('POST', '/api/community/reports', reporter, {
      topicId,
      reason: 'spam',
    });
    assert.equal(main.status, 404);
  });

  test('한 회원은 시간당 10개까지 (넘으면 429)', async () => {
    const reporter = await site.member('reporter_many', '많이신고');
    const ids: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      const comment = ok(
        await site.write(writer, 'POST', `/api/community/topics/${topicId}/comments`, {
          requestId: randomUUID(),
          body: `한도 확인 댓글 ${i}`,
        }),
        201,
      );
      ids.push(String(comment.id));
    }
    for (const commentId of ids.slice(0, 10))
      ok(await report(reporter, { commentId, reason: 'spam' }), 201);
    const over = await report(reporter, { commentId: ids[10], reason: 'spam' });
    assert.equal(over.status, 429, over.text);
  });
});
