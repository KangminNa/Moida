import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';

// 커뮤니티 글 (스토어 3-1b, docs/스토어.md 11.5): 누구나 읽고, 회원이 쓰고, 쓴 회원만 고치고 지운다.
// 쓰기 규칙(WriteLimits): 가입 직후 대기 · 시간당 한도 · 링크 수 · 같은 본문 · 차단. 지운 글은 없는 글과 같다

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let site: CommunitySite;
const mark = randomUUID().slice(0, 8);

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

function post(as: TestUser, title: string, body: string, requestId = randomUUID()) {
  return site.write(as, 'POST', '/api/community/topics', { requestId, title, body });
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  site = await CommunitySite.open(api, owner, `topics-${mark}`);
});
after(() => api.close());

describe('읽기와 쓰기', () => {
  test('회원이 쓰면 누구나 목록과 글을 읽는다 (작성자는 닉네임만, 내 글이면 version)', async () => {
    const writer = await site.member('writer_one', '글쓴이');
    const saved = ok(await post(writer, '  첫 글  ', '반가워요'), 201);
    assert.equal(saved.title, '첫 글');
    const list = ok(await site.at('/api/community/topics'));
    const line = (list.topics as Json[]).find((t) => t.id === saved.id) as Json;
    assert.deepEqual(line.author, { nickname: '글쓴이' });
    assert.equal(line.comments, 0);
    const asVisitor = ok(await site.at(`/api/community/topics/${saved.id}`));
    assert.equal(asVisitor.mine, false);
    assert.equal('version' in asVisitor, false);
    assert.doesNotMatch(JSON.stringify(asVisitor), /writer_one|member_id/);
    const asWriter = ok(await site.at(`/api/community/topics/${saved.id}`, { as: writer }));
    assert.equal(asWriter.mine, true);
    assert.equal(asWriter.version, 1);
  });

  test('방문자는 쓰지 못하고(401), 기본 도메인에서는 없는 주소', async () => {
    const res = await site.at('/api/community/topics', {
      method: 'POST',
      body: { requestId: randomUUID(), title: '방문자', body: '본문' },
    });
    assert.equal(res.status, 401);
    assert.equal((await api.get('/api/community/topics')).status, 404);
  });

  test('같은 requestId는 글 하나, 빈 제목 · 긴 본문 · 링크 6개는 422', async () => {
    const writer = await site.member('writer_two', '두번째');
    const id = randomUUID();
    const first = ok(await post(writer, '한 번만', '두 번 보내도 하나', id), 201);
    const again = ok(await post(writer, '한 번만', '두 번 보내도 하나', id), 201);
    assert.equal(again.id, first.id);
    assert.equal((await post(writer, '   ', '본문')).status, 422);
    assert.equal((await post(writer, '긴 글', 'x'.repeat(20_001))).status, 422);
    const links = Array.from({ length: 6 }, (_, i) => `https://spam${i}.example`).join(' ');
    assert.match((await post(writer, '링크', links)).text, /링크는 5개까지/);
  });

  test('고치기: 쓴 회원만, 버전이 맞아야 하고, 바뀌면 버전이 오른다. 남의 글은 403', async () => {
    const writer = await site.member('editor_one', '고치는이');
    const other = await site.member('editor_two', '남의글');
    const saved = ok(await post(writer, '고칠 글', '처음 본문'), 201);
    const edit = (as: TestUser, version: unknown, body = '고친 본문') =>
      site.write(as, 'PATCH', `/api/community/topics/${saved.id}`, {
        version,
        title: '고칠 글',
        body,
      });
    assert.equal((await edit(other, saved.version)).status, 403);
    const edited = ok(await edit(writer, saved.version));
    assert.equal(edited.version, Number(saved.version) + 1);
    assert.equal(typeof edited.editedAt, 'string');
    assert.equal((await edit(writer, saved.version, '또 고침')).status, 409);
  });

  test('지우면 목록 · 글에서 사라지고(404), 지운 글은 고칠 수 없다', async () => {
    const writer = await site.member('deleter_one', '지우는이');
    const saved = ok(await post(writer, '지울 글', '곧 사라짐'), 201);
    const del = await site.write(writer, 'DELETE', `/api/community/topics/${saved.id}`, {
      version: saved.version,
    });
    assert.equal(del.status, 204, del.text);
    assert.equal((await site.at(`/api/community/topics/${saved.id}`)).status, 404);
    const list = ok(await site.at('/api/community/topics'));
    assert.equal(
      (list.topics as Json[]).some((t) => t.id === saved.id),
      false,
    );
    const edit = await site.write(writer, 'PATCH', `/api/community/topics/${saved.id}`, {
      version: Number(saved.version) + 1,
      title: '살리기',
      body: '안 됨',
    });
    assert.equal(edit.status, 409);
  });

  test('목록은 30개씩, nextCursor로 다음 쪽', async () => {
    const other = await CommunitySite.open(api, owner, `pages-${mark}`);
    const writers = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map((i) => other.member(`pager_${i}`, `쪽${i}`)),
    );
    for (const [i, w] of writers.entries())
      for (let k = 0; k < 5; k += 1)
        assert.equal(
          (
            await other.write(w, 'POST', '/api/community/topics', {
              requestId: randomUUID(),
              title: `글 ${i}-${k}`,
              body: `본문 ${i}-${k}`,
            })
          ).status,
          201,
        );
    const first = ok(await other.at('/api/community/topics'));
    assert.equal((first.topics as Json[]).length, 30);
    const second = ok(await other.at(`/api/community/topics?cursor=${first.nextCursor}`));
    assert.equal((second.topics as Json[]).length, 5);
    assert.equal(second.nextCursor, null);
  });
});

describe('쓰기 규칙 (WriteLimits)', () => {
  test('가입하고 5분이 지나야 쓴다 (422)', async () => {
    const fresh = await site.member('fresh_one', '새내기', false);
    assert.match((await post(fresh, '바로 씀', '본문')).text, /가입하고 5분 뒤부터/);
  });

  test('한 시간에 글은 5개까지 (429), 같은 본문은 24시간 안에 다시 못 올린다 (409)', async () => {
    const busy = await site.member('busy_one', '바쁜이');
    for (let i = 0; i < 5; i += 1)
      assert.equal((await post(busy, `글 ${i}`, `본문 ${i}`)).status, 201);
    assert.equal((await post(busy, '여섯 번째', '본문 6')).status, 429);
    const repeat = await site.member('repeat_one', '되풀이');
    assert.equal((await post(repeat, '처음', '같은   내용')).status, 201);
    assert.equal((await post(repeat, '다시', '같은 내용')).status, 409);
  });

  test('차단된 회원은 쓰지 못하고 (403), 자기 글은 지울 수 있다', async () => {
    const bad = await site.member('blocked_one', '막힌이');
    const saved = ok(await post(bad, '막히기 전', '본문'), 201);
    const { Database } = await import('../../platform');
    await api.service(Database).sql`
      UPDATE community.members SET blocked_until = now() + interval '1 day'
      WHERE app_id = ${site.appId} AND login_id = 'blocked_one'`;
    assert.match((await post(bad, '막힌 뒤', '본문 2')).text, /차단된 회원/);
    const del = await site.write(bad, 'DELETE', `/api/community/topics/${saved.id}`, {
      version: saved.version,
    });
    assert.equal(del.status, 204);
  });
});
