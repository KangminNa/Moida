import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';
import { BaseEntity } from '../base/base-entity';
import { Database } from '../base/database';
import { Notices } from '../notice/notices';
import { FailedEvent } from './failed-event';

// 멈춘 이벤트 (리팩토링 R1): 8번 실패해 일꾼이 멈춘 이벤트를 관리자가 보고 다시 시도한다.
// 보는 사람별 결과 (방문자 · write 기기 · 관리자), 다른 공간의 것은 없는 것과 같고, 다시 시도하면 처음처럼 돌아가며
// 공간에 멈춘 것이 더 없으면 "처리 실패" 알림이 읽음이 된다.

let api: ApiClient;
let owner: TestUser;
let writer: string;
let db: Database;
let space: string;
const OTHER_SPACE = '00000000-0000-7000-8000-0000000fa11d';

/** 멈춘 이벤트 한 줄 (일꾼이 8번 실패한 뒤의 모양) */
async function stuck(spaceId: string, topic: string, trace: string | null): Promise<number> {
  const [row] = await db.sql<{ id: number }[]>`
    INSERT INTO platform.outbox (space_id, topic, payload, attempts, last_error, failed_at, trace_id)
    VALUES (${spaceId}, ${topic}, ${db.sql.json({ v: 1, taskId: 'task-1', approvalId: 'appr-1' })},
            8, '받는 쪽이 실패했어요', now(), ${trace})
    RETURNING id`;
  return Number(row?.id);
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = await api.writeDevice(owner, 'failed-event-writer');
  db = api.service(Database);
  space = String((await db.sql<{ id: string }[]>`SELECT id FROM account.spaces LIMIT 1`)[0]?.id);
});

after(() => api.close());

describe('멈춘 이벤트: 보는 사람', () => {
  test('방문자 · 기기 토큰(REST에서는 방문자)은 403', async () => {
    assert.equal((await api.get('/api/events/failed')).status, 403);
    const res = await api.request('GET', '/api/events/failed', TestUser.visitor, undefined, {
      authorization: `Bearer ${writer}`,
    });
    assert.equal(res.status, 403);
    assert.equal((await api.request('POST', '/api/events/1/retry')).status, 403);
  });

  test('관리자는 자기 공간의 멈춘 것만 최근부터 본다: 주제 · 내용(v 빼고) · 오류 · 요청 번호', async () => {
    const trace = BaseEntity.newId();
    const mine = await stuck(space, 'blog.post.publish_probe', trace);
    const others = await stuck(OTHER_SPACE, 'blog.post.publish_probe', null);
    const res = await api.get('/api/events/failed', owner);
    assert.equal(res.status, 200);
    const items = res.json().items as Record<string, unknown>[];
    const found = items.find((e) => e.id === mine);
    assert.deepEqual(
      {
        topic: found?.topic,
        data: found?.data,
        attempts: found?.attempts,
        lastError: found?.lastError,
        traceId: found?.traceId,
      },
      {
        topic: 'blog.post.publish_probe',
        data: { taskId: 'task-1', approvalId: 'appr-1' },
        attempts: 8,
        lastError: '받는 쪽이 실패했어요',
        traceId: trace,
      },
    );
    assert.ok(!items.some((e) => e.id === others), '다른 공간의 것은 보이지 않는다');
  });
});

describe('멈춘 이벤트: 다시 시도', () => {
  test('처음처럼 돌린다 (시도 0, 멈춤 없음, 바로 다음 차례). 두 번째는 409', async () => {
    const id = await stuck(space, 'vault.retry_probe', null);
    const res = await api.request('POST', `/api/events/${id}/retry`, owner);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json().failedAt, null);
    const [row] = await db.sql<
      { attempts: number; failed_at: Date | null; due: boolean; processed_at: Date | null }[]
    >`SELECT attempts, failed_at, next_attempt_at <= now() AS due, processed_at
        FROM platform.outbox WHERE id = ${id}`;
    assert.deepEqual(
      { attempts: row?.attempts, failed: row?.failed_at, due: row?.due },
      { attempts: 0, failed: null, due: true },
    );
    assert.equal((await api.request('POST', `/api/events/${id}/retry`, owner)).status, 409);
  });

  test('없는 번호 · 다른 공간의 것은 404, 번호 모양이 틀리면 400', async () => {
    const others = await stuck(OTHER_SPACE, 'vault.retry_probe', null);
    assert.equal((await api.request('POST', `/api/events/${others}/retry`, owner)).status, 404);
    assert.equal((await api.request('POST', '/api/events/999999999/retry', owner)).status, 404);
    assert.equal((await api.request('POST', '/api/events/abc/retry', owner)).status, 400);
  });

  test('공간에 멈춘 것이 더 없으면 "처리 실패" 알림이 읽음이 된다', async () => {
    // 앞 시험이 남긴 것까지 모두 돌린 뒤 하나만 남긴다
    await db.sql`UPDATE platform.outbox SET failed_at = NULL, processed_at = now()
                  WHERE space_id = ${space} AND failed_at IS NOT NULL`;
    const id = await stuck(space, 'task.notice_probe', null);
    await db.transaction((tx) =>
      new Notices(tx).post(FailedEvent.notice(space, id, 'task.notice_probe', '실패')),
    );
    const unread = () =>
      db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM platform.notifications
         WHERE space_id = ${space} AND group_key = ${FailedEvent.NOTICE_GROUP} AND read_at IS NULL`;
    assert.equal((await unread())[0]?.n, 1);
    assert.equal((await api.request('POST', `/api/events/${id}/retry`, owner)).status, 200);
    assert.equal((await unread())[0]?.n, 0);
  });
});
