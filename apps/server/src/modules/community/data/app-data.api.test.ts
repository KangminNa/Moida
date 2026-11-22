import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { CommunitySite } from '../../../testing/community-site';
import { Database, ZipReader } from '../../platform';

// 앱 데이터 (앱 플랫폼, docs/스토어.md 12.4): 앱이 cairn.json에 선언한 표가 그 앱의 스키마에 생기고, 앱 도메인에서 읽고 쓴다.
// 보는 사람별: 방문자 · 회원(쓴 회원 / 다른 회원) · 관리자. 규칙(anyone · member · owner · admin)은 DB의 행 수준 보안이 거른다

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let site: CommunitySite;
let ann: TestUser;
let bob: TestUser;
const mark = randomUUID().slice(0, 8);

const TABLES = {
  lessons: {
    columns: { title: 'text', level: 'int', body: 'json' },
    read: 'anyone',
    write: 'admin',
  },
  progress: {
    columns: { lesson: 'int', score: 'int', note: 'text', done: 'bool', at: 'time' },
    read: 'owner',
    write: 'owner',
  },
  scores: { columns: { name: 'text', xp: 'int' }, read: 'anyone', write: 'owner' },
  feedback: { columns: { text: 'text' }, read: 'admin', write: 'member' },
};

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const rowsOf = (res: ApiResult) => ok(res).rows as Json[];
const admin = (path: string) => `/api/community/admin/${site.appId}${path}`;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  site = await CommunitySite.openPage(api, owner, `data-${mark}`, {
    members: true,
    tables: TABLES,
  });
  ann = await site.member('ann_learner', '앤디');
  bob = await site.member('bob_learner', '밥이');
});
after(() => api.close());

describe('표 맞추기', () => {
  test('보이는 버전이 선언한 표가 열리고, 회원을 받는 앱이 된다', async () => {
    const { tables } = ok(await api.get(admin('/data'), owner)) as { tables: Json[] };
    assert.deepEqual(
      tables.map((t) => [t.name, t.read, t.write, t.open, t.rows]),
      [
        ['feedback', 'admin', 'member', true, 0],
        ['lessons', 'anyone', 'admin', true, 0],
        ['progress', 'owner', 'owner', true, 0],
        ['scores', 'anyone', 'owner', true, 0],
      ],
    );
    const app = ok(await api.get(`/api/apps/by-slug/data-${mark}`));
    assert.equal(app.members, true);
    // 방문자 · 회원은 관리 API에 닿지 않는다 (기본 도메인에서 403, 앱 도메인에서는 없는 주소)
    assert.equal((await api.get(admin('/data'))).status, 403);
    assert.equal((await site.at(admin('/data'), { as: ann })).status, 404);
  });

  test('회원 규칙(member · owner)의 표는 회원이 있는 앱에서만, 타입은 바꾸지 못한다', async () => {
    const other = await api.request('POST', '/api/apps', owner, {
      requestId: randomUUID(),
      kind: 'page',
      name: '회원 없는 앱',
      slug: `nomember-${mark}`,
    });
    const plain = new CommunitySite.Probe(api, String(ok(other, 201).id));
    const refused = await plain.deploy(owner, { tables: { progress: TABLES.progress } }, 422);
    assert.match(String(refused.text), /회원이 있는 앱에서만/);
    const changed = await site.deploy(
      owner,
      {
        members: true,
        tables: { ...TABLES, scores: { ...TABLES.scores, columns: { name: 'text', xp: 'text' } } },
      },
      422,
    );
    assert.match(String(changed.text), /타입은 바꿀 수 없어요: scores\.xp/);
    for (const bad of [
      { Lessons: TABLES.lessons },
      { lessons: { ...TABLES.lessons, columns: { id: 'text' } } },
      { lessons: { ...TABLES.lessons, columns: { title: 'varchar' } } },
      { lessons: { ...TABLES.lessons, write: 'anyone' } },
    ])
      await site.deploy(owner, { members: true, tables: bad }, 422);
  });
});

describe('읽기와 쓰기', () => {
  test('관리자가 넣은 줄을 누구나 읽는다: 조건 · 정렬 · 개수. 방문자는 쓰지 못한다', async () => {
    const added = ok(
      await api.request('POST', admin('/data/lessons'), owner, {
        rows: [
          { title: '인사', level: 1, body: { words: ['hello', 'hi'] } },
          { title: '식당', level: 2, body: { words: ['menu'] } },
          { title: '공항', level: 3, body: null },
        ],
      }),
      201,
    );
    assert.deepEqual(added, { table: 'lessons', added: 3 });
    const all = rowsOf(await site.at('/api/community/data/lessons?order=level.asc'));
    assert.deepEqual(
      all.map((r) => [r.title, r.level, r.mine]),
      [
        ['인사', 1, false],
        ['식당', 2, false],
        ['공항', 3, false],
      ],
    );
    assert.deepEqual(all[0]?.body, { words: ['hello', 'hi'] });
    assert.equal('owner' in (all[0] as Json), false, '쓴 회원의 id는 싣지 않는다');
    const hard = ok(
      await site.at('/api/community/data/lessons?level=gte.2&order=level.desc&limit=1'),
    );
    assert.deepEqual([(hard.rows as Json[])[0]?.title, hard.more], ['공항', true]);
    assert.equal(rowsOf(await site.at('/api/community/data/lessons?title=eq.식당')).length, 1);

    const post = { method: 'POST', body: { title: '몰래', level: 9 } };
    assert.equal((await site.at('/api/community/data/lessons', post)).status, 401);
    assert.equal(
      (await site.write(ann, 'POST', '/api/community/data/lessons', post.body)).status,
      404,
    );
    assert.equal(
      (await api.get('/api/community/data/lessons')).status,
      404,
      '기본 도메인은 없는 주소',
    );
  });

  test('owner 규칙: 자기 줄만 읽고 고치고 지운다. 남의 줄은 없는 줄과 같다', async () => {
    const mine = ok(
      await site.write(ann, 'POST', '/api/community/data/progress', {
        lesson: 1,
        score: 80,
        done: true,
        at: '2026-11-22T01:02:03.000Z',
      }),
      201,
    );
    assert.deepEqual(
      [mine.lesson, mine.score, mine.done, mine.note, mine.mine],
      [1, 80, true, null, true],
    );
    assert.equal(rowsOf(await site.at('/api/community/data/progress', { as: ann })).length, 1);
    assert.equal(rowsOf(await site.at('/api/community/data/progress', { as: bob })).length, 0);
    assert.equal(rowsOf(await site.at('/api/community/data/progress')).length, 0);

    const path = `/api/community/data/progress/${mine.id}`;
    assert.equal((await site.write(bob, 'PATCH', path, { score: 0 })).status, 404);
    assert.equal((await site.write(bob, 'DELETE', path)).status, 404);
    const edited = ok(await site.write(ann, 'PATCH', path, { score: 95, note: '다시 풀었다' }));
    assert.deepEqual([edited.score, edited.note, edited.lesson], [95, '다시 풀었다', 1]);
    assert.equal((await site.write(ann, 'DELETE', path)).status, 204);
    assert.equal(rowsOf(await site.at('/api/community/data/progress', { as: ann })).length, 0);
  });

  test('순위표: 누구나 읽는 표에 회원이 자기 줄을 쓰고, owner=eq.me로 내 줄을 찾는다', async () => {
    ok(await site.write(ann, 'POST', '/api/community/data/scores', { name: '앤', xp: 120 }), 201);
    ok(await site.write(bob, 'POST', '/api/community/data/scores', { name: '밥', xp: 300 }), 201);
    const top = rowsOf(await site.at('/api/community/data/scores?order=xp.desc&limit=10'));
    assert.deepEqual(
      top.map((r) => [r.name, r.xp]),
      [
        ['밥', 300],
        ['앤', 120],
      ],
    );
    const own = rowsOf(await site.at('/api/community/data/scores?owner=eq.me', { as: ann }));
    assert.deepEqual(
      own.map((r) => [r.name, r.mine]),
      [['앤', true]],
    );
    assert.equal(rowsOf(await site.at('/api/community/data/scores?owner=eq.me')).length, 0);
    // 남의 점수는 고치지 못한다
    const bobs = top[0] as Json;
    assert.equal(
      (await site.write(ann, 'PATCH', `/api/community/data/scores/${bobs.id}`, { xp: 1 })).status,
      404,
    );
  });

  test('member 쓰기 · admin 읽기: 회원은 보내기만 하고 관리자만 읽는다', async () => {
    ok(await site.write(ann, 'POST', '/api/community/data/feedback', { text: '재밌어요' }), 201);
    assert.equal((await site.at('/api/community/data/feedback', { as: ann })).status, 404);
    const rows = rowsOf(await api.get(admin('/data/feedback'), owner));
    assert.equal(rows[0]?.text, '재밌어요');
    assert.equal(typeof rows[0]?.owner, 'string', '관리자에게는 쓴 회원까지');
    // 관리자가 줄을 지운다
    assert.equal(
      (await api.request('DELETE', admin(`/data/feedback/${rows[0]?.id}`), owner)).status,
      204,
    );
    assert.equal(rowsOf(await api.get(admin('/data/feedback'), owner)).length, 0);
  });

  test('틀린 요청: 없는 표 404, 모르는 칸 · 틀린 타입 · 긴 글 422, 틀린 조건 400, 다른 사이트의 쓰기 403', async () => {
    const write = (body: object) => site.write(ann, 'POST', '/api/community/data/progress', body);
    assert.equal((await site.at('/api/community/data/nothing')).status, 404);
    assert.equal((await write({ nope: 1 })).status, 422);
    assert.equal((await write({ score: '높음' })).status, 422);
    assert.equal((await write({ note: 'x'.repeat(10_001) })).status, 422);
    assert.equal((await write({ owner: randomUUID() })).status, 422, '붙인 칸은 쓰지 못한다');
    assert.equal((await write({})).status, 422);
    assert.equal((await site.at('/api/community/data/lessons?level=like.1')).status, 400);
    assert.equal((await site.at('/api/community/data/lessons?nope=eq.1')).status, 400);
    assert.equal((await site.at('/api/community/data/lessons?order=body.asc')).status, 400);
    const cross = await site.at('/api/community/data/progress', {
      method: 'POST',
      as: ann,
      body: { score: 1 },
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(cross.status, 403);
  });
});

describe('DB가 거른다 (행 수준 보안)', () => {
  test('회원 쪽 역할은 조건 없이 물어도 자기 줄만 보고, 다른 모듈의 표에는 권한이 없다', async () => {
    ok(
      await site.write(ann, 'POST', '/api/community/data/progress', { lesson: 2, score: 50 }),
      201,
    );
    ok(
      await site.write(bob, 'POST', '/api/community/data/progress', { lesson: 2, score: 60 }),
      201,
    );
    const db = api.service(Database);
    const schema = `app_${site.appId.replaceAll('-', '')}`;
    const seen = await db.transaction(async (tx) => {
      const [me] = await tx<{ id: string }[]>`
        SELECT id FROM community.members WHERE app_id = ${site.appId} AND login_id = 'ann_learner'`;
      await tx`SELECT set_config('cairn.member', ${me?.id ?? ''}, true)`;
      await tx.unsafe('SET LOCAL ROLE cairn_app');
      const rows = await tx.unsafe(`SELECT score FROM "${schema}"."progress"`);
      const updated = await tx.unsafe(`UPDATE "${schema}"."progress" SET score = 0`);
      return [rows.map((r) => r.score), updated.count];
    });
    assert.deepEqual(seen, [[50], 1], '조건 없는 SELECT · UPDATE도 자기 줄에만 닿는다');
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE cairn_app');
        await tx.unsafe('SELECT count(*) FROM community.members');
      }),
      /permission denied/,
    );
    const all = rowsOf(await api.get(admin('/data/progress?order=score.asc'), owner));
    assert.deepEqual(
      all.map((r) => r.score),
      [0, 60],
    );
  });
});

describe('버전이 바뀌면', () => {
  test('더한 칸이 열리고, 선언에서 뺀 표는 닫힌다 (줄은 남는다). 내보내기에는 선언 · SQL · 회원이 든다', async () => {
    const { scores: _dropped, ...kept } = TABLES;
    await site.deploy(owner, {
      members: true,
      tables: {
        ...kept,
        progress: { ...TABLES.progress, columns: { ...TABLES.progress.columns, streak: 'int' } },
      },
    });
    ok(
      await site.write(ann, 'POST', '/api/community/data/progress', { lesson: 3, streak: 7 }),
      201,
    );
    assert.equal((await site.at('/api/community/data/scores')).status, 404);
    const { tables } = ok(await api.get(admin('/data'), owner)) as { tables: Json[] };
    const closed = tables.find((t) => t.name === 'scores') as Json;
    assert.deepEqual([closed.open, closed.rows], [false, 2]);

    const res = await fetch(`${api.baseUrl}${admin('/export')}`, {
      headers: { cookie: owner.header ?? '' },
    });
    assert.equal(res.status, 200);
    const files = new Map(
      [...ZipReader.read(Buffer.from(await res.arrayBuffer()))].map(([name, data]) => [
        name,
        data.toString('utf8'),
      ]),
    );
    assert.deepEqual([...files.keys()].sort(), [
      'data.sql',
      'members.json',
      'schema.sql',
      'tables.json',
    ]);
    assert.match(files.get('schema.sql') ?? '', /CREATE TABLE "progress" \([\s\S]*"streak" bigint/);
    assert.match(
      files.get('data.sql') ?? '',
      /INSERT INTO "scores" \("id", "owner", [^)]*\) VALUES \('[0-9a-f-]{36}', '[0-9a-f-]{36}', /,
    );
    const members = (JSON.parse(files.get('members.json') ?? '{}') as { members: Json[] }).members;
    assert.deepEqual(members.map((m) => m.login_id).sort(), ['ann_learner', 'bob_learner']);
    assert.equal((await api.get(admin('/export'))).status, 403);
  });
});
