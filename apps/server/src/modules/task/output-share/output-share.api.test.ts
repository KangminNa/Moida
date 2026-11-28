import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 결과물 공유 링크 (기획서 결정 2026-11-19): 관리자가 결과물 하나를 기간(1 · 7 · 30일)을 정해 로그인 없이 볼 수 있게 연다.
// 링크(/share/<토큰>)는 웹이 GET api/output-shares/open/<토큰>으로 넘긴다. 끄거나 기간이 지나거나 휴지통에 가면 404

type Json = Record<string, unknown>;
type Share = { id: string; outputId: string; outputName: string; path: string; live: boolean };
let api: ApiClient;
let owner: TestUser;
let dir: string;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};

/** 관리자가 파일 하나를 결과물로 올린다 */
async function upload(name: string, body: string): Promise<Json> {
  const res = await fetch(`${api.baseUrl}/api/outputs/files?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', cookie: owner.header },
    body: Buffer.from(body),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as Json;
}

const share = async (outputId: unknown, days = 7, requestId = randomUUID()) =>
  api.request('POST', '/api/output-shares', owner, { requestId, outputId, days });
/** 링크로 연다 (로그인 없이) */
const open = (path: string) => api.get(`/api/output-shares/open/${path.replace('/share/', '')}`);

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moida-share-test-'));
  process.env.MOIDA_BLOBS_DIR = dir;
  process.env.MOIDA_DISK_RESERVE_GB = '0';
  api = await ApiClient.start();
  owner = await api.signIn();
});

after(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});

describe('결과물 공유 링크', () => {
  test('방문자 · write 기기는 목록도 만들기도 못 한다 (403)', async () => {
    const output = await upload('막힌 표.csv', 'a,b\n1,2\n');
    assert.equal((await api.get('/api/output-shares', TestUser.visitor)).status, 403);
    const token = await api.writeDevice(owner, `공유 기기 ${randomUUID()}`);
    const asDevice = await fetch(`${api.baseUrl}/api/output-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId: randomUUID(), outputId: output.id, days: 7 }),
    });
    assert.equal(asDevice.status, 403);
    const asVisitor = await api.request('POST', '/api/output-shares', TestUser.visitor, {
      requestId: randomUUID(),
      outputId: output.id,
      days: 7,
    });
    assert.equal(asVisitor.status, 403);
  });

  test('만들면 로그인 없이 열리고, 격리 · 틀 금지 · Referer 없음 · 검색 제외로 보낸다. 같은 요청은 같은 링크', async () => {
    const output = await upload('보고서.md', '# 보고서\n<script>alert(1)</script>\n');
    const requestId = randomUUID();
    const made = ok(await share(output.id, 7, requestId), 201) as Share;
    assert.match(made.path, /^\/share\/[0-9a-f-]{36}\.[\w-]{43}$/);
    assert.deepEqual([made.outputId, made.outputName, made.live], [output.id, '보고서.md', true]);
    assert.equal((ok(await share(output.id, 7, requestId), 201) as Share).id, made.id);

    const res = await open(made.path);
    assert.equal(res.status, 200, res.text);
    assert.match(res.text, /# 보고서/);
    assert.match(
      String(res.header('content-security-policy')),
      /^sandbox.*frame-ancestors 'none'$/,
    );
    assert.equal(res.header('x-content-type-options'), 'nosniff');
    assert.equal(res.header('x-frame-options'), 'DENY');
    assert.equal(res.header('referrer-policy'), 'no-referrer');
    assert.equal(res.header('x-robots-tag'), 'noindex, nofollow');
    assert.match(String(res.header('cache-control')), /no-store/);

    const list = ok(await api.get(`/api/output-shares?outputId=${output.id}`, owner)) as {
      shares: Share[];
    };
    assert.deepEqual(
      list.shares.map((s) => [s.id, s.path]),
      [[made.id, made.path]],
    );
  });

  test('서명이 틀리거나 모양이 아니면 없는 링크와 같은 404', async () => {
    const output = await upload('서명.txt', '서명 시험');
    const made = ok(await share(output.id), 201) as Share;
    const [id] = made.path.replace('/share/', '').split('.');
    assert.equal((await open(`${id}.${'A'.repeat(43)}`)).status, 404);
    assert.equal((await open(`${randomUUID()}.${'A'.repeat(43)}`)).status, 404);
    assert.equal((await open('아무거나')).status, 404);
  });

  test('끄면 바로 닫히고 목록에서 빠진다. 다시 꺼도 그대로', async () => {
    const output = await upload('끌 것.txt', '끄기 시험');
    const made = ok(await share(output.id), 201) as Share;
    const ended = ok(
      await api.request('POST', `/api/output-shares/${made.id}/end`, owner),
    ) as Share;
    assert.equal(ended.live, false);
    assert.equal((await open(made.path)).status, 404);
    ok(await api.request('POST', `/api/output-shares/${made.id}/end`, owner));
    const list = ok(await api.get('/api/output-shares', owner)) as { shares: Share[] };
    assert.ok(!list.shares.some((s) => s.id === made.id));
    assert.equal(
      (await api.request('POST', `/api/output-shares/${randomUUID()}/end`, owner)).status,
      404,
    );
  });

  test('기간이 지나거나 결과물이 휴지통에 가면 열리지 않는다. 휴지통의 결과물은 새로 공유하지 못한다', async () => {
    const output = await upload('기간.txt', '기간 시험');
    const old = ok(await share(output.id, 1), 201) as Share;
    await api.service(Database).sql`
      UPDATE task.output_shares SET created_at = now() - interval '2 days',
        expires_at = now() - interval '1 day' WHERE id = ${old.id}`;
    assert.equal((await open(old.path)).status, 404);

    const live = ok(await share(output.id, 30), 201) as Share;
    assert.equal((await open(live.path)).status, 200);
    const outputs = ok(await api.get('/api/outputs', owner)) as { outputs: Json[] };
    const version = outputs.outputs.find((o) => o.id === output.id)?.version;
    const deleted = ok(
      await api.request('POST', `/api/outputs/${output.id}/delete`, owner, { version }),
    );
    assert.equal((await open(live.path)).status, 404);
    const trashed = await share(output.id);
    assert.equal(trashed.status, 422, trashed.text);
    assert.match(trashed.text, /휴지통/);

    // 휴지통에서 바로 지우면 공유 줄도 함께 사라진다 (같은 DB의 다른 시험 파일에 휴지통을 남기지 않는다)
    const purged = await api.request('POST', `/api/outputs/${output.id}/purge`, owner, {
      version: deleted.version,
    });
    assert.equal(purged.status, 204, purged.text);
    const [left] = await api.service(Database).sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM task.output_shares WHERE output_id = ${String(output.id)}`;
    assert.equal(left?.n, 0);
  });

  test('기간은 1 · 7 · 30일 중 하나 (422), 없는 결과물은 404', async () => {
    const output = await upload('기간 값.txt', '기간 값');
    const wrong = await share(output.id, 3);
    assert.equal(wrong.status, 422, wrong.text);
    assert.match(wrong.text, /1 · 7 · 30일/);
    assert.equal((await share(randomUUID())).status, 404);
    assert.equal((await share(output.id, 31)).status, 400);
  });
});
