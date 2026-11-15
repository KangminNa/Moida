import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Database, Notices, Outbox } from '../modules/platform';
import { ApiClient, type ApiResult, type TestUser } from './api-client';

// 마감을 바꾸는 쓰기는 같은 트랜잭션에서 그 마감 작업을 깨운다 (리팩토링 2단계 worker 정책).
// 일꾼이 듣는 채널(cairn_outbox)을 함께 듣고, 진짜 API로 쓸 때마다 `due:<작업>` 신호가 오는지 본다.
// 일꾼은 쉬는 동안 조회하지 않으므로, 여기서 빠진 깨우기는 다음 마감까지(없으면 영영) 일이 늦는다는 뜻이다.
// 작업 이름은 신호의 약속이라 글자로 적는다 (모듈 안쪽을 가져오지 않는다): 바꾸면 여기도 함께 바꾼다.

/** 마감 작업 이름 (JOBS.schedules · JOBS.toolChecks · JOBS.tidyDaily) */
const JOBS = {
  schedules: 'task.schedules',
  toolChecks: 'task.external_tools.check',
  tidyDaily: 'vault.tidy-daily',
};

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let listener: ReturnType<Database['listen']>;
const heard: string[] = [];

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** 이 일을 하면 그 마감 작업을 깨우는 신호가 온다 */
async function wakes(job: string, work: () => Promise<unknown>): Promise<void> {
  heard.length = 0;
  await work();
  const deadline = Date.now() + 3000;
  while (!heard.includes(Outbox.DUE + job)) {
    assert.ok(Date.now() < deadline, `${job}을(를) 깨우지 않았어요: ${JSON.stringify(heard)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  const { version } = (await api.get('/api/space')).json() as { version: number };
  ok(
    await api.request('PUT', '/api/space', owner, {
      name: '돌무더기',
      siteUrl: api.baseUrl,
      version,
    }),
  );
  listener = api.service(Database).listen(Outbox.CHANNEL, (payload) => {
    heard.push(payload);
  });
  await listener.ready;
});

after(async () => {
  await listener.stop();
  await api.close();
});

describe('마감을 바꾸는 쓰기는 그 마감 작업을 깨운다', () => {
  test('스케줄을 만들면 스케줄 작업을 깨운다', async () => {
    await wakes(JOBS.schedules, async () =>
      ok(
        await api.request('POST', '/api/schedules', owner, {
          requestId: randomUUID(),
          title: '깨우기 확인',
          enabled: true,
          mode: 'daily',
          atTime: '09:30',
          weekdays: [1, 2, 3, 4, 5],
          timeZone: 'Asia/Seoul',
          instruction: '확인해 주세요',
          dailyMax: 1,
        }),
        201,
      ),
    );
  });

  test('커넥터를 만들면 커넥터 확인 작업을 깨운다', async () => {
    await wakes(JOBS.toolChecks, async () =>
      ok(
        await api.request('POST', '/api/external-tools', owner, {
          requestId: randomUUID(),
          title: '깨우기',
          name: `wake${randomUUID().slice(0, 6)}`,
          url: 'https://mcp.example.com/mcp',
        }),
        201,
      ),
    );
  });

  test('세션 정리 설정을 저장하면 하루 정리 작업을 깨운다', async () => {
    const { version } = ok(await api.get('/api/tidy/settings', owner)) as { version: number };
    await wakes(JOBS.tidyDaily, async () =>
      ok(
        await api.request('PUT', '/api/tidy/settings', owner, {
          autoTidy: true,
          cadence: 'daily',
          version,
        }),
      ),
    );
  });

  test('알림이 남거나 알림 설정이 바뀌면 푸시 작업을 깨운다', async () => {
    // 새 기기 연결은 즉시 알림을 남긴다 (account.device.connected)
    await wakes(Notices.PUSH_JOB, () =>
      api.connectDevice(owner, `wake-${randomUUID().slice(0, 6)}`),
    );
    const { version } = ok(await api.get('/api/notice-settings', owner)) as { version: number };
    await wakes(Notices.PUSH_JOB, async () =>
      ok(
        await api.request('PUT', '/api/notice-settings', owner, {
          digest: 'daily',
          digestTime: '08:00',
          timeZone: 'Asia/Seoul',
          routes: {},
          version,
        }),
      ),
    );
  });
});
