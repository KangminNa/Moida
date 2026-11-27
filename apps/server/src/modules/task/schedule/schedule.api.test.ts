import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { TestMailbox } from '../../../testing/test-mailbox';
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
    assert.equal((await create({ ...DAILY, dailyMax: 289 })).status, 400);
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

  test('페이지를 가리키면 그 페이지의 만들기 일. 같은 페이지를 고치는 일이 돌면 건너뛴다. 담당은 어느 에이전트든 된다 (2026-11-21)', async () => {
    const pageId = randomUUID();
    // 모든 에이전트가 같은 권한이라 따로 make 권한을 주지 않은 에이전트도 만들기 일을 맡는다
    const maker = await newAgent();
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

  test('하루 한도: 일꾼은 한도에서 멈추고, 지금 한 번은 세지 않고 한도에 닿아도 만든다 (2026-11-20)', async () => {
    const schedule = ok(await create({ ...DAILY, instruction: '한도 시험', dailyMax: 1 }), 201);
    const run = (s: Json) =>
      api.request('POST', `/api/schedules/${s.id}/run`, owner, { version: s.version });
    const cancelQueued = async () => {
      for (const t of await tasksOf(schedule)) {
        const d = ok(await api.get(`/api/tasks/${t.id}`, owner));
        if (d.status === 'queued')
          ok(await api.request('POST', `/api/tasks/${t.id}/cancel`, owner, { version: d.version }));
      }
    };
    await makeDue(schedule);
    await job.run();
    assert.equal((await tasksOf(schedule)).length, 1);
    await cancelQueued();
    await makeDue(schedule);
    await job.run();
    assert.equal((await tasksOf(schedule)).length, 1, '한도에 닿으면 일꾼은 만들지 않는다');
    const [full] = (await list()).filter((s) => s.id === schedule.id);
    const task = ok(await run(full as Json));
    assert.match(String(task.title), /^아침 확인 \(/);
    const [after] = (await list()).filter((s) => s.id === schedule.id);
    assert.deepEqual(
      [(await tasksOf(schedule)).length, after?.dayRuns],
      [2, 1],
      '지금 한 번은 세지 않는다',
    );
    await cancelQueued();
  });

  test('N분마다 (2026-11-20): 5~720분, 간격만 남고 다음 시각이 생긴다', async () => {
    const minutely = { ...DAILY, mode: 'minutely', atTime: undefined, weekdays: undefined };
    const made = ok(await create({ ...minutely, everyMinutes: 10, dailyMax: 144 }), 201);
    assert.deepEqual(
      [made.mode, made.everyMinutes, made.everyHours, made.atTime, made.dailyMax],
      ['minutely', 10, null, null, 144],
    );
    assert.ok(made.nextRunAt, '켜면 다음 시각');
    assert.equal(new Date(String(made.nextRunAt)).getUTCMinutes() % 10, 0);
    assert.equal((await create({ ...minutely, everyMinutes: 3 })).status, 400);
    assert.equal((await create({ ...minutely })).status, 422, '간격이 없으면');
    const removed = await api.request('POST', `/api/schedules/${made.id}/delete`, owner, {
      version: made.version,
    });
    assert.equal(removed.status, 204, removed.text);
  });

  test('한 번 실행 · 캘린더 (2026-11-27): 날짜에 등록하면 그때 한 번 돌고 꺼진다. 캘린더에 돌 시각과 지난 실행이 보인다', async () => {
    const runAt = new Date(Date.now() + 3 * 86_400_000);
    const once = {
      ...DAILY,
      title: '보고서 마감',
      mode: 'once',
      atTime: undefined,
      weekdays: undefined,
    };
    const made = ok(await create({ ...once, runAt: runAt.toISOString() }), 201);
    assert.equal(made.mode, 'once');
    assert.equal(made.runAt, runAt.toISOString());
    assert.equal(made.nextRunAt, runAt.toISOString());
    assert.equal((await create({ ...once })).status, 422, '날짜가 없으면');
    const past = await create({ ...once, runAt: new Date(Date.now() - 60_000).toISOString() });
    assert.equal(past.status, 422, past.text);
    assert.match(past.text, /지난 시각/);

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const calendar = async () =>
      ok(await api.get(`/api/schedules/calendar?from=${from}&to=${to}`, owner)) as {
        planned: Json[];
        runs: Json[];
      };
    const before = await calendar();
    assert.ok(before.planned.some((p) => p.scheduleId === made.id && p.at === runAt.toISOString()));
    assert.equal((await api.get(`/api/schedules/calendar?from=${from}&to=${to}`)).status, 403);
    const tooLong = new Date(Date.now() + 90 * 86_400_000).toISOString();
    assert.equal(
      (await api.get(`/api/schedules/calendar?from=${from}&to=${tooLong}`, owner)).status,
      400,
    );

    await makeDue(made);
    await job.run();
    const tasks = await tasksOf(made);
    assert.equal(tasks.length, 1);
    const [after] = (await list()).filter((s) => s.id === made.id);
    assert.equal(after?.enabled, false, '한 번 돈 뒤 꺼진다');
    assert.equal(after?.nextRunAt, null);
    const done = await calendar();
    assert.ok(!done.planned.some((p) => p.scheduleId === made.id));
    const run = done.runs.find((r) => r.scheduleId === made.id);
    assert.equal(run?.taskId, tasks[0]?.id);
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

    test('대화로 보내면 대표가 처음엔 대화를 열고(없으면 대표를 만든다), 다음 차례부터 같은 대화의 회차. 지킬 것은 지시 뒤에, 받을 것은 회차마다 (받을 것을 고쳐도 같은 대화)', async () => {
      const recipe = {
        ...DAILY,
        title: '주간 보고',
        agentId: null,
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
      const { lead } = ok(await api.get('/api/agents/lead', owner)) as { lead: Json };
      assert.deepEqual([chat.agentId, chat.turns, chat.deliver], [lead.id, 1, null]);
      const deliverOf = async (taskId: string) =>
        (
          await db.sql`SELECT payload->'chat'->>'deliver' AS d FROM task.tasks WHERE id = ${taskId}`
        )[0]?.d;
      assert.equal(await deliverOf(first.id), 'html', '받을 것은 회차에 싣는다 (O-4)');

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

      // 받을 것을 고쳐도 같은 대화에 이어 쌓이고, 다음 회차가 새 받을 것을 싣는다 (O-4)
      await cancel(String(turns[1]?.id));
      const [now] = (await list()).filter((s) => s.id === schedule.id);
      const edited = ok(
        await api.request('PATCH', `/api/schedules/${schedule.id}`, owner, {
          ...recipe,
          deliver: 'file',
          version: now?.version,
        }),
      );
      assert.equal(edited.chatId, opened?.chatId, '대화에 묶인 채로');
      await makeDue(schedule, 1);
      await job.run();
      const third = (await turnsOf(schedule))[2];
      assert.ok(third, '같은 대화의 셋째 회차');
      assert.equal(await deliverOf(third.id), 'file');
      // 대화가 아닌 곳으로 보내게 바꾸면 대화를 놓는다
      await cancel(third.id);
      const [later] = (await list()).filter((s) => s.id === schedule.id);
      const moved = ok(
        await api.request('PATCH', `/api/schedules/${schedule.id}`, owner, {
          ...recipe,
          destination: 'task',
          deliver: null,
          version: later?.version,
        }),
      );
      assert.equal(moved.chatId, null);
    });

    test('대화로 보내는 레시피는 대표가 맡아 담당을 비운다 (O-2), 받을 것은 대화에만 (422)', async () => {
      const head = await newAgent({ name: `팀장 ${randomUUID().slice(0, 6)}` });
      const chatTo = (agentId: unknown, more: Json = {}) =>
        create({ ...DAILY, agentId, destination: 'chat', instruction: '정리', ...more });
      const refused = await chatTo(head.id);
      assert.equal(refused.status, 422, refused.text);
      assert.match(refused.text, /대표가 맡아요/);
      assert.equal((await chatTo(null, { instruction: '' })).status, 422, '지시가 있어야 한다');
      assert.equal((await create({ ...DAILY, instruction: '요약', deliver: 'html' })).status, 422);
    });

    test('메일로 받기 (2026-11-27): 대화로 보낼 때만, 메일을 보낼 수 있어야 켜고, 회차와 다시 맡긴 회차가 payload.chat.mail을 싣는다', async () => {
      const recipe = {
        ...DAILY,
        title: '아침 요약 메일',
        agentId: null,
        destination: 'chat',
        instruction: '어제 소식을 다섯 줄로 요약해 줘',
        mail: true,
      };
      const notReady = await create(recipe);
      assert.equal(notReady.status, 502, notReady.text);
      assert.match(notReady.text, /메일 플러그인/);
      TestMailbox.install(api);
      const notChat = await create({ ...recipe, destination: 'task' });
      assert.equal(notChat.status, 422, notChat.text);
      assert.match(notChat.text, /대화로 보낼 때만/);
      const schedule = ok(await create(recipe), 201);
      assert.equal(schedule.mail, true);
      assert.equal(ok(await create({ ...recipe, mail: undefined }), 201).mail, false, '기본은 끔');
      await makeDue(schedule, 3);
      await job.run();
      const [first] = await turnsOf(schedule);
      assert.ok(first, '첫 회차');
      const [row] = await db.sql<{ mail: boolean | null }[]>`
        SELECT (payload->'chat'->>'mail')::boolean AS mail FROM task.tasks WHERE id = ${first.id}`;
      assert.equal(row?.mail, true, '회차가 메일로 받기를 싣는다');
      await cancel(first.id);
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
