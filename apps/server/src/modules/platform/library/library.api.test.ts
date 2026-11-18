import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { OutboxWorker } from '../worker/outbox-worker';

// 보관함 (2차 5단계): 결과물 · 페이지 · 읽은 글 · 세션 · 위키 · 글을 한 목록으로. 모듈마다 자기 읽기를 등록하고
// platform이 시간순으로 모은다. 주인만 (비공개가 섞인다)

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let writer: string;
let collector: string;
const mark = randomUUID().slice(0, 8);
const made: Json = {};

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const library = async (query = '') =>
  ok(await api.get(`/api/library${query ? `?${query}` : ''}`, owner)) as {
    items: Json[];
    next: string | null;
  };
const mine = (items: Json[]) => items.filter((i) => String(i.title).includes(mark));

before(async () => {
  // 결과물을 올리는 시험: 디스크 여유 몫을 끈다 (다른 결과물 시험과 같다)
  process.env.CAIRN_DISK_RESERVE_GB = '0';
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = await api.writeDevice(owner, `library-writer-${mark}`);
  collector = await api.connectDevice(owner, `library-collector-${mark}`, 'collect');
  made.post = ok(
    await api.request('POST', '/api/posts', owner, {
      appId: await api.blogApp(owner),
      requestId: randomUUID(),
      title: `글 ${mark}`,
      body: '본문',
    }),
    201,
  );
  made.link = ok(
    await api.request('POST', '/api/basket/items', owner, {
      requestId: randomUUID(),
      kind: 'link',
      url: `https://example.com/${mark}`,
      title: `읽은 글 ${mark}`,
    }),
    201,
  );
  made.wiki = ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: `위키 ${mark}`,
      bodyMd: '## 칸\n\n내용',
    }),
    201,
  );
  const saved = await api.mcp(collector, 'tools/call', {
    name: 'save_transcript',
    arguments: {
      request_id: randomUUID(),
      tool: 'claude-code',
      source_session_id: `lib-${mark}`,
      project: `proj-${mark}`,
      title: `세션 ${mark}`,
      text: '## 사람\n보관함 만들기',
    },
  });
  made.session = (saved.json().result as Json).structuredContent;
  const upload = await fetch(
    `${api.baseUrl}/api/outputs/files?name=${encodeURIComponent(`결과물 ${mark}.csv`)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        cookie: `cairn_session=${owner.cookies.cairn_session}`,
      },
      body: Buffer.from('가,1\n'),
    },
  );
  assert.equal(upload.status, 201, await upload.clone().text());
  made.output = await upload.json();
});
after(async () => {
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  await api.close();
});

describe('보관함 (GET /api/library)', () => {
  test('방문자 · 기기 토큰은 보지 못한다 (403)', async () => {
    assert.equal((await api.get('/api/library', TestUser.visitor)).status, 403);
    const bearer = await fetch(`${api.baseUrl}/api/library`, {
      headers: { authorization: `Bearer ${writer}` },
    });
    assert.equal(bearer.status, 403, '기기 토큰은 REST에서 방문자와 같다');
  });

  test('종류와 상관없이 최근 것부터, 종류마다 콘솔 주소 · 바깥 주소', async () => {
    const items = mine((await library()).items);
    const kinds = items.map((i) => i.kind);
    assert.deepEqual(
      [...kinds].sort(),
      ['link', 'output', 'post', 'session', 'wiki'],
      '이 시험이 만든 다섯 종류',
    );
    assert.deepEqual(kinds, ['output', 'session', 'wiki', 'link', 'post'], '나중에 만든 것부터');
    const byKind = Object.fromEntries(items.map((i) => [i.kind, i]));
    assert.equal(byKind.post.href, `/admin/posts/${made.post.id}`);
    assert.equal(byKind.post.url, null, '임시 글은 바깥 주소가 없다');
    assert.deepEqual(
      [byKind.link.href, byKind.link.url],
      ['/admin/library/basket', `https://example.com/${mark}`],
    );
    assert.equal(byKind.wiki.href, `/admin/wiki?wiki=${made.wiki.id}`);
    assert.deepEqual(
      [byKind.session.href, byKind.session.project],
      [`/admin/sessions?session=${made.session.session_id}`, `proj-${mark}`],
    );
    assert.equal(byKind.output.href, '/admin/library/outputs', '작업 없이 올린 결과물');
  });

  test('종류 · 프로젝트로 거른다 (프로젝트를 아는 종류는 세션뿐)', async () => {
    const wikis = (await library('kind=wiki')).items;
    assert.ok(wikis.length > 0 && wikis.every((i) => i.kind === 'wiki'));
    const inProject = (await library(`project=proj-${mark}`)).items;
    assert.deepEqual(
      inProject.map((i) => [i.kind, i.title]),
      [['session', `세션 ${mark}`]],
    );
  });

  test('기간으로 거르고, 한 쪽(30개)이 넘으면 next로 이어 읽는다', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.deepEqual((await library(`from=${future}`)).items, []);
    for (let i = 0; i < 31; i++)
      ok(
        await api.request('POST', '/api/basket/items', owner, {
          requestId: randomUUID(),
          kind: 'link',
          url: `https://example.com/page/${mark}/${i}`,
          title: `쪽 ${mark} ${i}`,
        }),
        201,
      );
    const first = await library('kind=link');
    assert.equal(first.items.length, 30);
    assert.ok(first.next);
    const second = await library(`kind=link&cursor=${first.next}`);
    const ids = new Set(first.items.map((i) => i.id));
    assert.ok(second.items.length > 0);
    assert.ok(
      second.items.every((i) => !ids.has(i.id)),
      '앞 쪽과 겹치지 않는다',
    );
    assert.equal((await api.get('/api/library?cursor=xyz', owner)).status, 400);
  });
});
