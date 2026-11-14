import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, DomainEvent } from '../../platform';
import { IssuePublishHandler } from './issue-publish.handler';

// /api/issues (2차 6단계 매거진 호): 호 목록 메뉴 안의 번호, 글은 순서대로, 발행은 호 전체를 한 번에.
// 관리자의 발행과 결재한 발행(blog.issue.publish) 모두 하나라도 못 하면 아무것도 바뀌지 않는다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
let menu: Json;
const mark = randomUUID().slice(0, 6);

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const newPost = async (title: string) =>
  ok(
    await api.request('POST', '/api/posts', owner, {
      requestId: randomUUID(),
      title,
      body: '본문',
    }),
    201,
  );
const newIssue = async (title: string) =>
  ok(
    await api.request('POST', '/api/issues', owner, {
      requestId: randomUUID(),
      menuId: menu.id,
      title,
    }),
    201,
  );
const detail = async (id: unknown) => ok(await api.get(`/api/issues/${id}`, owner));

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, `issue-writer-${mark}`)}` };
  menu = ok(
    await api.request('POST', '/api/menus', owner, {
      requestId: randomUUID(),
      kind: 'issues',
      name: `매거진 ${mark}`,
      slug: `mag-${mark}`,
    }),
    201,
  );
});
after(() => api.close());

describe('매거진 호 (/api/issues)', () => {
  test('호 목록 메뉴에만, 번호는 1부터 차례로. 방문자 · write 기기는 만들지 못한다', async () => {
    const first = await newIssue(`창간호 ${mark}`);
    const second = await newIssue(`2호 ${mark}`);
    assert.deepEqual([first.number, second.number, first.status], [1, 2, 'draft']);
    const posts = ok(
      await api.request('POST', '/api/menus', owner, {
        requestId: randomUUID(),
        kind: 'posts',
        name: `글들 ${mark}`,
      }),
      201,
    );
    const wrong = await api.request('POST', '/api/issues', owner, {
      requestId: randomUUID(),
      menuId: posts.id,
      title: '안 됨',
    });
    assert.equal(wrong.status, 422, wrong.text);
    for (const headers of [{}, writer]) {
      const denied = await api.request(
        'POST',
        '/api/issues',
        TestUser.visitor,
        { requestId: randomUUID(), menuId: menu.id, title: '막힘' },
        headers,
      );
      assert.equal(denied.status, 403, denied.text);
    }
  });

  test('관리자가 글을 순서대로 넣고 발행하면 호와 글이 함께 공개된다. 방문자는 발행한 호만', async () => {
    const issue = await newIssue(`가을호 ${mark}`);
    const a = await newPost(`가을 첫 글 ${mark}`);
    const b = await newPost(`가을 둘째 글 ${mark}`);
    const filled = ok(
      await api.request('POST', `/api/issues/${issue.id}/posts`, owner, {
        version: issue.version,
        postIds: [b.id, a.id],
      }),
    );
    const before = await detail(issue.id);
    assert.deepEqual(
      (before.postList as Json[]).map((p) => [p.id, p.order, p.status]),
      [
        [b.id, 1, 'draft'],
        [a.id, 2, 'draft'],
      ],
    );
    const hidden = await api.get(`/api/issues/by-number/mag-${mark}/${issue.number}`);
    assert.equal(hidden.status, 404, '발행 전에는 방문자에게 없다');

    const published = ok(
      await api.request('POST', `/api/issues/${issue.id}/publish`, owner, {
        version: filled.version,
      }),
    );
    assert.equal(published.status, 'published');
    const seen = ok(await api.get(`/api/issues/by-number/mag-${mark}/${issue.number}`));
    assert.deepEqual(
      (seen.posts as Json[]).map((p) => p.slug),
      [b.slug, a.slug],
    );
    const listed = ok(await api.get(`/api/issues?menu=mag-${mark}`)).issues as Json[];
    assert.ok(listed.some((i) => i.number === issue.number));
    const closed = await api.request('POST', `/api/issues/${issue.id}/posts`, owner, {
      version: published.version,
      postIds: [],
    });
    assert.equal(closed.status, 422, '발행한 호에는 글을 바꾸지 못한다');
  });

  test('휴지통 글이 든 호 · 빈 호는 발행하지 않고 아무것도 바뀌지 않는다 (422)', async () => {
    const issue = await newIssue(`빈 호 ${mark}`);
    const empty = await api.request('POST', `/api/issues/${issue.id}/publish`, owner, {
      version: issue.version,
    });
    assert.equal(empty.status, 422, empty.text);
    const ok1 = await newPost(`살아 있는 글 ${mark}`);
    const gone = await newPost(`지울 글 ${mark}`);
    const filled = ok(
      await api.request('POST', `/api/issues/${issue.id}/posts`, owner, {
        version: issue.version,
        postIds: [ok1.id, gone.id],
      }),
    );
    const trashed = ok(await api.get(`/api/posts/${gone.id}`, owner));
    ok(await api.request('DELETE', `/api/posts/${gone.id}`, owner, { version: trashed.version }));
    const refused = await api.request('POST', `/api/issues/${issue.id}/publish`, owner, {
      version: filled.version,
    });
    assert.equal(refused.status, 422, refused.text);
    const still = ok(await api.get(`/api/posts/${ok1.id}`, owner));
    assert.equal(still.status, 'draft', '앞 글도 공개되지 않았다');
  });

  test('결재한 발행: 결재한 버전일 때만, 같은 결재는 한 번. 바뀐 호는 실패 결과만 남긴다', async () => {
    const issue = await newIssue(`결재호 ${mark}`);
    const post = await newPost(`결재 글 ${mark}`);
    const filled = ok(
      await api.request('POST', `/api/issues/${issue.id}/posts`, owner, {
        version: issue.version,
        postIds: [post.id],
      }),
    );
    const db = api.service(Database);
    const [row] = await db.sql<{ space_id: string }[]>`
      SELECT space_id FROM blog.issues WHERE id = ${String(issue.id)}`;
    const spaceId = String(row?.space_id);
    const handler = api.service(IssuePublishHandler);
    const grant = (approvalId: string, targetVersion: number) =>
      handler.handle(
        new DomainEvent('task.approval.granted', 1, spaceId, {
          approvalId,
          action: 'blog.issue.publish',
          decidedBy: randomUUID(),
          targetId: issue.id,
          targetVersion,
        }),
      );
    const results = async (approvalId: string) =>
      db.sql<{ topic: string; outcome: string }[]>`
        SELECT topic, payload->>'outcome' AS outcome FROM platform.outbox
        WHERE payload->>'approvalId' = ${approvalId} ORDER BY id`;

    const stale = randomUUID();
    await grant(stale, Number(filled.version) - 1);
    assert.deepEqual(
      (await results(stale)).map((r) => [r.topic, r.outcome]),
      [['blog.issue.publish_failed', 'failed']],
    );
    assert.equal((await detail(issue.id)).status, 'draft', '바뀐 호는 발행하지 않는다');

    const approved = randomUUID();
    await grant(approved, Number(filled.version));
    await grant(approved, Number(filled.version));
    assert.deepEqual(
      (await results(approved)).map((r) => [r.topic, r.outcome]),
      [
        ['blog.issue.published', 'done'],
        ['blog.issue.published', 'done'],
      ],
      '같은 결재가 다시 오면 같은 결과를 다시 낸다 (발행은 한 번)',
    );
    assert.equal((await detail(issue.id)).status, 'published');
    assert.equal(ok(await api.get(`/api/posts/${post.id}`, owner)).status, 'published');
  });
});
