import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, DomainEvent } from '../../platform';
import { ScheduleJob } from './schedule.job';
import { ScheduleFollowHandler } from './schedule-follow.handler';

// /api/schedules: 보는 사람별 결과 (방문자 · write 기기 · 주인)와 일꾼의 돌리기 · 하루 한도.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let job: ScheduleJob;
/** write 권한을 준 기기의 Bearer 머리글. 관리 일은 이 기기에게도 막혀야 한다 */
let writer: Readonly<Record<string, string>>;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  job = api.service(ScheduleJob);
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'schedule-writer')}` };
});
/** 스케줄이 만든 끝나지 않은 작업을 모두 취소한다: 같은 DB를 쓰는 다음 시험 파일의 러너가 빌려 가지 않게 */
after(async () => {
  const open = await db.sql<{ id: string }[]>`
    SELECT id FROM task.tasks
    WHERE (request_id LIKE 'schedule:%' OR payload->'chat'->>'requestId' LIKE 'schedule:%')
      AND status IN ('queued', 'running', 'waiting')`;
  for (const { id } of open) {
    const detail = ok(await api.get(`/api/tasks/${id}`, owner));
    ok(await api.request('POST', `/api/tasks/${id}/cancel`, owner, { version: detail.version }));
  }
  await api.close();
});

/** 이 테스트의 스케줄만 돌게 앞 테스트의 것을 끈다 */
beforeEach(async () => {
  await db.sql`UPDATE task.schedules SET enabled = false, next_run_at = NULL`;
});

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function newAgent(more: Json = {}): Promise<Json> {
  return ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '확인 담당',
      tool: 'claude',
      ...more,
    }),
    201,
  );
}

const DAILY = {
  title: '아침 확인',
  enabled: true,
  mode: 'daily',
  atTime: '09:30',
  weekdays: [1, 2, 3, 4, 5],
  timeZone: 'Asia/Seoul',
  instruction: '이번 주 글 진행을 확인해 주세요',
  dailyMax: 3,
};

const create = (body: Json, as = owner, headers: Record<string, string> = {}) =>
  api.request('POST', '/api/schedules', as, { requestId: randomUUID(), ...body }, headers);

const list = async (query = '') =>
  (ok(await api.get(`/api/schedules${query}`, owner)) as { schedules: Json[] }).schedules;

/** 다음 시각을 지난 때로 돌려 일꾼이 바로 돌리게 한다 */
async function makeDue(schedule: Json, minutesAgo = 1): Promise<void> {
  await db.sql`
    UPDATE task.schedules SET enabled = true, next_run_at = now() - make_interval(mins => ${minutesAgo})
    WHERE id = ${String(schedule.id)}`;
}

async function tasksOf(schedule: Json): Promise<Json[]> {
  return [
    ...(await db.sql`
      SELECT id, status, title, instruction, goal_id, agent_id, request_id FROM task.tasks
      WHERE request_id LIKE ${`schedule:${schedule.id}:%`} ORDER BY id`),
  ];
}

describe('스케줄 (/api/schedules)', () => {
  test('방문자와 write 기기는 보지도 만들지도 못한다 (403)', async () => {
    for (const headers of [{}, writer]) {
      assert.equal((await create(DAILY, TestUser.visitor, headers)).status, 403);
      const read = await api.request('GET', '/api/schedules', TestUser.visitor, undefined, headers);
      assert.equal(read.status, 403, read.text);
    }
  });

  test('주인이 만들면 다음 시각이 생기고 목록에 실린다. 같은 requestId는 하나, version으로 늦은 쓰기를 막는다', async () => {
    const agent = await newAgent();
    const requestId = randomUUID();
    const made = ok(await create({ ...DAILY, agentId: agent.id, requestId }), 201);
    assert.equal(ok(await create({ ...DAILY, agentId: agent.id, requestId }), 201).id, made.id);
    assert.equal(made.enabled, true);
    assert.equal(made.atTime, '09:30');
    assert.deepEqual(made.weekdays, [1, 2, 3, 4, 5]);
    assert.equal(made.dailyMax, 3);
    assert.ok(new Date(String(made.nextRunAt)).getTime() > Date.now());
    assert.deepEqual(
      (await list(`?agentId=${agent.id}`)).map((s) => s.id),
      [made.id],
    );
    const agents = (ok(await api.get('/api/agents', owner)) as { agents: Json[] }).agents;
    assert.equal(agents.find((a) => a.id === agent.id)?.schedules, 1, '에이전트 목록의 스케줄 수');

    const patch = (body: Json) => api.request('PATCH', `/api/schedules/${made.id}`, owner, body);
    const hourly = ok(
      await patch({
        ...DAILY,
        agentId: agent.id,
        mode: 'hourly',
        everyHours: 6,
        version: made.version,
      }),
    );
    assert.equal(hourly.atTime, null);
    assert.equal(hourly.everyHours, 6);
    assert.equal((await patch({ ...DAILY, version: made.version })).status, 409, '늦은 쓰기');
    const off = ok(
      await patch({ ...DAILY, agentId: agent.id, enabled: false, version: hourly.version }),
    );
    assert.equal(off.nextRunAt, null, '끄면 다음 시각이 없다');

    const removed = await api.request('POST', `/api/schedules/${made.id}/delete`, owner, {
      version: off.version,
    });
    assert.equal(removed.status, 204, removed.text);
    assert.equal(
      (await list()).some((s) => s.id === made.id),
      false,
    );
  });

  test('모양이 틀리면 400, 뜻이 틀리면 422, 없는 에이전트는 404', async () => {
    const shape = await create({ ...DAILY, atTime: '9시' });
    assert.equal(shape.status, 400, shape.text);
    assert.ok((shape.json().fields as Json).atTime);
    assert.equal((await create({ ...DAILY, dailyMax: 30 })).status, 400);
    assert.equal((await create({ ...DAILY, timeZone: 'Mars/Base' })).status, 422);
    assert.equal((await create({ ...DAILY, weekdays: [] })).status, 422);
    assert.equal((await create({ ...DAILY, mode: 'hourly' })).status, 422);
    assert.equal((await create({ ...DAILY, instruction: '' })).status, 422, '담당도 지시도 없음');
    assert.equal((await create({ ...DAILY, agentId: randomUUID() })).status, 404);

    const goal = ok(
      await api.request('POST', '/api/goals', owner, { requestId: randomUUID(), title: '닫힘' }),
      201,
    );
    ok(
      await api.request('POST', `/api/goals/${goal.id}/status`, owner, {
        status: 'dropped',
        version: goal.version,
      }),
    );
    assert.equal((await create({ ...DAILY, goalId: goal.id })).status, 422, '닫힌 목표');
  });

  test('때가 되면 일꾼이 작업 하나를 만들고 다음 시각으로 넘긴다. 두 번 돌아도 하나', async () => {
    const goal = ok(
      await api.request('POST', '/api/goals', owner, { requestId: randomUUID(), title: '블로그' }),
      201,
    );
    const agent = await newAgent();
    const schedule = ok(await create({ ...DAILY, agentId: agent.id, goalId: goal.id }), 201);
    await makeDue(schedule);

    await Promise.all([job.run(), job.run()]);
    const tasks = await tasksOf(schedule);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.status, 'queued');
    assert.equal(tasks[0]?.instruction, DAILY.instruction);
    assert.equal(tasks[0]?.goal_id, goal.id);
    assert.equal(tasks[0]?.agent_id, agent.id);
    assert.match(String(tasks[0]?.title), /^아침 확인 \(/);
    const [after] = (await list()).filter((s) => s.id === schedule.id);
    assert.ok(new Date(String(after?.nextRunAt)).getTime() > Date.now(), '다음 시각으로 넘어감');
    assert.equal(after?.dayRuns, 1);

    const next = await job.run();
    assert.equal((await tasksOf(schedule)).length, 1, '다음 시각 전에는 더 만들지 않는다');
    // 마감 작업 (리팩토링 2단계): 켜진 스케줄의 가장 이른 다음 시각을 돌려준다 (일꾼이 그때 깬다)
    assert.ok(next && next <= new Date(String(after?.nextRunAt)), String(next));
  });

  test('담당이 없으면 지시대로 자동 배정 작업, 앞 작업이 끝나지 않았거나 담당이 멈췄으면 건너뛴다', async () => {
    const free = ok(await create({ ...DAILY, instruction: '뉴스 요약' }), 201);
    await makeDue(free);
    await job.run();
    const [unassigned] = await tasksOf(free);
    assert.equal(unassigned?.agent_id, null);

    const agent = await newAgent();
    const schedule = ok(await create({ ...DAILY, agentId: agent.id }), 201);
    await makeDue(schedule, 3);
    await job.run();
    await makeDue(schedule, 2);
    await job.run();
    assert.equal((await tasksOf(schedule)).length, 1, '앞 작업이 아직 대기 중');

    const [first] = await tasksOf(schedule);
    const { version } = ok(await api.get(`/api/tasks/${first?.id}`, owner));
    ok(await api.request('POST', `/api/tasks/${first?.id}/cancel`, owner, { version }));
    const paused = ok(
      await api.request('POST', `/api/agents/${agent.id}/pause`, owner, { version: agent.version }),
    );
    await makeDue(schedule, 1);
    await job.run();
    assert.equal((await tasksOf(schedule)).length, 1, '멈춘 에이전트');
    ok(
      await api.request('POST', `/api/agents/${agent.id}/resume`, owner, {
        version: paused.version,
      }),
    );
    await makeDue(schedule, 1);
    await job.run();
    assert.equal((await tasksOf(schedule)).length, 2, '다시 움직이면 돈다');
  });

  test('페이지를 가리키면 그 페이지의 만들기 일. 같은 페이지를 고치는 일이 돌면 건너뛰고, 담당은 make 권한이 있어야 한다', async () => {
    const pageId = randomUUID();
    const plain = await newAgent();
    const refused = await create({ ...DAILY, agentId: plain.id, pageId });
    assert.equal(refused.status, 422, refused.text);
    const maker = await newAgent({ scopes: ['make'] });
    const schedule = ok(
      await create({ ...DAILY, title: '현황판', agentId: maker.id, pageId }),
      201,
    );
    assert.equal(schedule.pageId, pageId);
    await makeDue(schedule);
    await job.run();
    const [made] = await tasksOf(schedule);
    const [row] = await db.sql<{ kind: string; payload: { page?: Json } }[]>`
      SELECT kind, payload FROM task.tasks WHERE id = ${String(made?.id)}`;
    assert.deepEqual([row?.kind, row?.payload.page], ['make', { pageId }]);

    const other = ok(
      await create({ ...DAILY, title: '같은 페이지', agentId: maker.id, pageId }),
      201,
    );
    await makeDue(other);
    await job.run();
    assert.equal((await tasksOf(other)).length, 0, '같은 페이지를 고치는 일이 돌고 있다');
    const [skipped] = (await list()).filter((s) => s.id === other.id);
    const now = await api.request('POST', `/api/schedules/${other.id}/run`, owner, {
      version: skipped?.version,
    });
    assert.equal(now.status, 409, now.text);
    assert.match(now.text, /이 페이지를 고치는 일이 이미 돌고 있어요/);
    const [kept] = (await list()).filter((s) => s.id === other.id);
    assert.equal(kept?.dayRuns, 0, '만들지 못한 지금 한 번은 세지 않는다');
  });

  test('하루 한도: 지금 한 번도 함께 세고, 닿으면 일꾼도 건너뛰고 지금 한 번은 422', async () => {
    const schedule = ok(await create({ ...DAILY, instruction: '한도 시험', dailyMax: 2 }), 201);
    const run = (s: Json) =>
      api.request('POST', `/api/schedules/${s.id}/run`, owner, { version: s.version });
    const task = ok(await run(schedule));
    assert.match(String(task.title), /^아침 확인 \(/);
    const [counted] = (await list()).filter((s) => s.id === schedule.id);
    assert.equal(counted?.dayRuns, 1);
    // 지금 한 번으로 만든 작업을 끝내 두고 일꾼이 하나를 더 만든다 (둘째)
    const detail = ok(await api.get(`/api/tasks/${task.id}`, owner));
    ok(
      await api.request('POST', `/api/tasks/${task.id}/cancel`, owner, { version: detail.version }),
    );
    await makeDue(schedule);
    await job.run();
    assert.equal((await tasksOf(schedule)).length, 2);
    const [full] = (await list()).filter((s) => s.id === schedule.id);
    const refused = await run(full as Json);
    assert.equal(refused.status, 422, refused.text);
    assert.match(refused.text, /오늘 한도\(2번\)/);
    for (const t of await tasksOf(schedule)) {
      const d = ok(await api.get(`/api/tasks/${t.id}`, owner));
      if (d.status === 'queued')
        ok(await api.request('POST', `/api/tasks/${t.id}/cancel`, owner, { version: d.version }));
    }
    await makeDue(schedule);
    await job.run();
    assert.equal((await tasksOf(schedule)).length, 2, '한도에 닿으면 일꾼도 만들지 않는다');
  });

  describe('자동화 레시피 (2차 5단계)', () => {
    /** 대화 레시피가 만든 회차 작업들 (회차를 보낸 요청이 schedule:<레시피>:) */
    const turnsOf = (schedule: Json) =>
      db.sql<{ id: string; status: string; instruction: string; request_id: string }[]>`
        SELECT id, status, instruction, request_id FROM task.tasks
        WHERE payload->'chat'->>'requestId' LIKE ${`schedule:${schedule.id}:%`} ORDER BY created_at`;
    const cancel = async (id: string) => {
      const { version } = ok(await api.get(`/api/tasks/${id}`, owner));
      ok(await api.request('POST', `/api/tasks/${id}/cancel`, owner, { version }));
    };

    test('대화로 보내면 처음엔 대화를 열고, 다음 차례부터 같은 대화의 회차. 지킬 것은 지시 뒤에, 받을 것은 대화의 받을 것', async () => {
      const agent = await newAgent({ name: `레시피 담당 ${randomUUID().slice(0, 6)}` });
      const recipe = {
        ...DAILY,
        title: '주간 보고',
        agentId: agent.id,
        destination: 'chat',
        instruction: '이번 주 글 진행을 정리해 줘',
        rules: '표 하나로, 다섯 줄 넘지 않게',
        deliver: 'html',
      };
      const schedule = ok(await create(recipe), 201);
      assert.deepEqual(
        [schedule.destination, schedule.trigger, schedule.deliver, schedule.chatId],
        ['chat', 'time', 'html', null],
      );
      await makeDue(schedule, 3);
      await job.run();
      const [first] = await turnsOf(schedule);
      assert.ok(first, '첫 회차');
      assert.match(
        first.instruction,
        /^이번 주 글 진행을 정리해 줘\n\n# 지킬 것\n[^\n]+\n표 하나로, 다섯 줄 넘지 않게$/,
      );
      const [opened] = (await list()).filter((s) => s.id === schedule.id);
      assert.ok(opened?.chatId, '연 대화를 기억한다');
      const { chat } = ok(await api.get(`/api/chats/${opened?.chatId}`, owner)) as { chat: Json };
      assert.deepEqual([chat.agentId, chat.turns, chat.deliver], [agent.id, 1, 'html']);

      await makeDue(schedule, 2);
      await job.run();
      assert.equal((await turnsOf(schedule)).length, 1, '앞 회차의 답을 기다리는 중');
      await cancel(first.id);
      await makeDue(schedule, 1);
      await job.run();
      const turns = await turnsOf(schedule);
      assert.equal(turns.length, 2);
      const again = ok(await api.get(`/api/chats/${opened?.chatId}`, owner)) as { chat: Json };
      assert.equal(again.chat.turns, 2, '같은 대화의 다음 회차');
    });

    test('대화는 관리자 바로 아래 에이전트와만, 받을 것은 대화에만 (422)', async () => {
      const lead = await newAgent({ name: `팀장 ${randomUUID().slice(0, 6)}` });
      const member = await newAgent({
        name: `팀원 ${randomUUID().slice(0, 6)}`,
        reportsTo: lead.id,
      });
      const chatTo = (agentId: unknown, more: Json = {}) =>
        create({ ...DAILY, agentId, destination: 'chat', instruction: '정리', ...more });
      assert.equal((await chatTo(member.id)).status, 422);
      assert.equal((await chatTo(null)).status, 422, '담당이 있어야 한다');
      assert.equal((await create({ ...DAILY, instruction: '요약', deliver: 'html' })).status, 422);
    });

    test('손으로만 도는 레시피는 시각이 없고 "지금 실행"으로만 돈다', async () => {
      const schedule = ok(
        await create({ ...DAILY, instruction: '손으로 요약', trigger: 'manual' }),
        201,
      );
      assert.equal(schedule.nextRunAt, null);
      await job.run();
      assert.equal((await tasksOf(schedule)).length, 0);
      ok(
        await api.request('POST', `/api/schedules/${schedule.id}/run`, owner, {
          version: schedule.version,
        }),
      );
      const [task] = await tasksOf(schedule);
      assert.equal(task?.instruction, '손으로 요약', '지킬 것이 없으면 지시 그대로');
    });

    test('다른 레시피의 일이 끝나면 뒤 레시피가 한 번 돈다. 서로 기다리는 고리는 막는다', async () => {
      const first = ok(
        await create({ ...DAILY, title: '수집', instruction: '모아 줘', trigger: 'manual' }),
        201,
      );
      const next = ok(
        await create({
          ...DAILY,
          title: '정리',
          instruction: '모은 것을 정리해 줘',
          trigger: 'after',
          afterId: first.id,
        }),
        201,
      );
      assert.equal(next.nextRunAt, null);
      const made = ok(
        await api.request('POST', `/api/schedules/${first.id}/run`, owner, {
          version: first.version,
        }),
      );
      const handler = api.service(ScheduleFollowHandler);
      const { space_id: spaceId } = (
        await db.sql<
          { space_id: string }[]
        >`SELECT space_id FROM task.tasks WHERE id = ${String(made.id)}`
      )[0] as { space_id: string };
      const finished = new DomainEvent('task.task.changed', 1, spaceId, {
        taskId: made.id,
        status: 'done',
      });
      await handler.handle(finished);
      assert.equal((await tasksOf(next)).length, 0, '끝나지 않은 일로는 돌지 않는다');
      await db.sql`UPDATE task.tasks SET status = 'done' WHERE id = ${String(made.id)}`;
      await handler.handle(finished);
      await handler.handle(finished);
      const followed = await tasksOf(next);
      assert.equal(followed.length, 1, '같은 끝남은 한 번만');
      assert.equal(followed[0]?.instruction, '모은 것을 정리해 줘');

      const [current] = (await list()).filter((s) => s.id === first.id);
      const loop = await api.request('PATCH', `/api/schedules/${first.id}`, owner, {
        ...DAILY,
        title: '수집',
        instruction: '모아 줘',
        trigger: 'after',
        afterId: next.id,
        version: current?.version,
      });
      assert.equal(loop.status, 422, loop.text);
      assert.match(loop.text, /고리/);
    });
  });
});
