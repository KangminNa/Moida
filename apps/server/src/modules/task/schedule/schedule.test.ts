import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import { Schedule } from './schedule';
import { SchedulePolicy } from './schedule.policy';

// 스케줄의 시각 계산 · 하루 한도 · 작업 만들기. DB 없이 돈다.

const SEOUL = 'Asia/Seoul';
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL = [1, 2, 3, 4, 5, 6, 7];
const at = (iso: string) => new Date(iso);

describe('SchedulePolicy.nextDaily', () => {
  test('시간대 기준 그날의 시각이 아직이면 오늘, 지났으면 내일', () => {
    // 2026-11-06(금) 08:00 KST = 2026-11-05T23:00Z
    assert.equal(
      SchedulePolicy.nextDaily(9 * 60, ALL, SEOUL, at('2026-11-05T23:00:00Z')).toISOString(),
      '2026-11-06T00:00:00.000Z',
    );
    // 09:00 KST 정각이면 다음 날 (지금보다 뒤의 첫 시각)
    assert.equal(
      SchedulePolicy.nextDaily(9 * 60, ALL, SEOUL, at('2026-11-06T00:00:00Z')).toISOString(),
      '2026-11-07T00:00:00.000Z',
    );
  });

  test('고른 요일만: 금요일 저녁이면 다음 월요일', () => {
    // 2026-11-06(금) 20:00 KST
    assert.equal(
      SchedulePolicy.nextDaily(
        9 * 60 + 30,
        WEEKDAYS,
        SEOUL,
        at('2026-11-06T11:00:00Z'),
      ).toISOString(),
      '2026-11-09T00:30:00.000Z',
    );
    // 일요일만
    assert.equal(
      SchedulePolicy.nextDaily(0, [7], SEOUL, at('2026-11-06T11:00:00Z')).toISOString(),
      '2026-11-07T15:00:00.000Z',
      '일요일 00:00 KST',
    );
  });

  test('서머타임이 있는 시간대는 그날의 오프셋으로 계산한다', () => {
    const ny = 'America/New_York';
    // 2026-11-01(일)에 EDT(-4) → EST(-5)
    assert.equal(
      SchedulePolicy.nextDaily(9 * 60, ALL, ny, at('2026-10-31T12:00:00Z')).toISOString(),
      '2026-10-31T13:00:00.000Z',
      '10/31 09:00 EDT',
    );
    assert.equal(
      SchedulePolicy.nextDaily(9 * 60, ALL, ny, at('2026-10-31T14:00:00Z')).toISOString(),
      '2026-11-01T14:00:00.000Z',
      '11/1 09:00 EST',
    );
  });
});

describe('SchedulePolicy.nextHourly', () => {
  test('시간대 기준 시가 N으로 나누어떨어지는 다음 정각', () => {
    // 10:20 KST → 12:00 KST (4시간마다: 0·4·8·12·16·20시)
    assert.equal(
      SchedulePolicy.nextHourly(4, SEOUL, at('2026-11-06T01:20:00Z')).toISOString(),
      '2026-11-06T03:00:00.000Z',
    );
    assert.equal(
      SchedulePolicy.nextHourly(1, SEOUL, at('2026-11-06T01:00:00Z')).toISOString(),
      '2026-11-06T02:00:00.000Z',
      '정각이면 다음 정각',
    );
    assert.equal(
      SchedulePolicy.nextHourly(24, SEOUL, at('2026-11-06T01:00:00Z')).toISOString(),
      '2026-11-06T15:00:00.000Z',
      '24시간마다는 자정',
    );
  });

  test('오프셋이 30분인 시간대도 그 시간대의 정각에 맞춘다', () => {
    // 인도 +05:30. 10:20 IST = 04:50Z → 11:00 IST = 05:30Z
    assert.equal(
      SchedulePolicy.nextHourly(1, 'Asia/Kolkata', at('2026-11-06T04:50:00Z')).toISOString(),
      '2026-11-06T05:30:00.000Z',
    );
  });

  test('알 수 없는 시간대는 거절한다', () => {
    assert.throws(() => SchedulePolicy.assertTimeZone('Mars/Olympus'), RuleViolation);
    SchedulePolicy.assertTimeZone(SEOUL);
  });
});

describe('SchedulePolicy.dayOf', () => {
  test('시간대 기준 날짜: 서울 자정 넘어가면 다음 날', () => {
    assert.equal(SchedulePolicy.dayOf(at('2026-11-05T14:59:00Z'), SEOUL), '2026-11-05');
    assert.equal(SchedulePolicy.dayOf(at('2026-11-05T15:00:00Z'), SEOUL), '2026-11-06');
    assert.equal(SchedulePolicy.dayOf(at('2026-11-05T15:00:00Z'), 'UTC'), '2026-11-05');
  });
});

describe('Schedule', () => {
  const NOW = at('2026-11-05T23:00:00Z'); // 11/6(금) 08:00 KST

  /** configure에 넘기는 설정 한 벌 (바꿀 칸만 덮어쓴다) */
  const settings = (more: Record<string, unknown> = {}) => ({
    title: '아침 정리',
    agent_id: 'agent-1',
    mode: 'daily',
    at_minute: 9 * 60,
    weekdays: ALL,
    every_hours: null,
    time_zone: SEOUL,
    instruction: '',
    goal_id: null,
    daily_max: 3,
    enabled: true,
    ...more,
  });

  const daily = (more: Record<string, unknown> = {}) => Schedule.open('space', settings(more), NOW);

  test('켜면 다음 시각이 생기고, 끄면 지운다. N시간마다면 시각 칸을 지운다', () => {
    const schedule = daily();
    assert.equal(schedule.unsaved.next_run_at?.toISOString(), '2026-11-06T00:00:00.000Z');
    schedule.configure(
      settings({ mode: 'hourly', at_minute: null, every_hours: 6, enabled: false }),
      NOW,
    );
    assert.equal(schedule.unsaved.next_run_at, null);
    assert.equal(schedule.unsaved.at_minute, null);
    assert.equal(schedule.unsaved.every_hours, 6);
  });

  test('맞지 않는 설정은 거절한다', () => {
    const bad = [
      { title: '  ' },
      { title: 'x'.repeat(121) },
      { mode: 'weekly' },
      { at_minute: null },
      { at_minute: 1440 },
      { weekdays: [] },
      { weekdays: [8] },
      { mode: 'hourly', every_hours: 0 },
      { mode: 'hourly', every_hours: 25 },
      { time_zone: 'Nowhere/City' },
      { daily_max: 0 },
      { daily_max: 25 },
      { agent_id: null, instruction: '' },
    ];
    for (const more of bad) assert.throws(() => daily(more), RuleViolation, JSON.stringify(more));
    daily({ agent_id: null, instruction: '뉴스 모아 요약' });
  });

  test('때가 되면 이번 시각을 돌려주고 다음 시각으로. 여러 번 놓쳤어도 한 번만 돈다', () => {
    const schedule = daily();
    assert.equal(schedule.dueAt(NOW), false);
    assert.throws(() => schedule.fire(NOW), RuleViolation);
    // 사흘 동안 꺼져 있다가 11/9 10:00 KST에 깨어남
    const late = at('2026-11-09T01:00:00Z');
    const slot = schedule.fire(late);
    assert.equal(slot.toISOString(), '2026-11-06T00:00:00.000Z', '놓친 첫 시각 하나');
    assert.equal(schedule.unsaved.next_run_at?.toISOString(), '2026-11-10T00:00:00.000Z');
    assert.equal(schedule.unsaved.last_run_at, late);
    assert.equal(schedule.dueAt(late), false);
  });

  test('하루 한도: 시간대 기준 하루에 정한 수만큼, 날이 바뀌면 다시 센다. 지금 한 번도 함께 센다', () => {
    const schedule = daily({ daily_max: 2 });
    const morning = at('2026-11-06T00:00:00Z'); // 11/6 09:00 KST
    assert.equal(schedule.claimRun(morning), true);
    assert.equal(schedule.runNow(morning).toISOString(), morning.toISOString());
    assert.equal(schedule.claimRun(morning), false, '셋째는 넘는다');
    assert.throws(() => schedule.runNow(morning), /오늘 한도\(2번\)/);
    assert.deepEqual([schedule.unsaved.run_day, schedule.unsaved.day_runs], ['2026-11-06', 2]);
    const nextDay = at('2026-11-06T15:30:00Z'); // 11/7 00:30 KST
    assert.equal(schedule.claimRun(nextDay), true);
    assert.deepEqual([schedule.unsaved.run_day, schedule.unsaved.day_runs], ['2026-11-07', 1]);
  });

  test('작업: request_id · 제목 · 지시 · 담당 · payload. 지시가 비면 정기 확인', () => {
    const schedule = daily();
    const slot = at('2026-11-06T00:00:00Z');
    assert.equal(schedule.requestIdFor(slot), `schedule:${schedule.id}:2026-11-06T00:00:00.000Z`);
    assert.match(schedule.titleFor(slot), /^아침 정리 \(11\. 6\. 09:00\)$/);
    assert.equal(schedule.taskInstruction, Schedule.DEFAULT_INSTRUCTION);
    const task = daily({ agent_id: null, instruction: '뉴스 요약' }).wake(
      slot,
      null,
      '뉴스 요약',
      NOW,
    );
    const row = task.unsaved;
    assert.equal(row.agent_id, null, '담당이 없으면 빌릴 때 자동 배정');
    assert.equal(row.instruction, '뉴스 요약');
    assert.equal(row.kind, 'general');
    assert.deepEqual((row.payload as { schedule: { at: string } }).schedule.at, slot.toISOString());
  });

  test('레시피: 어디로 ↔ 페이지 · 담당 · 지시, 받을 것은 대화에만, 계기 ↔ 앞 레시피, 대화는 대표가 (O-2)', () => {
    const page = daily({ page_id: 'page-1' });
    assert.equal(page.destination, Schedule.PAGE, '페이지가 있으면 기본은 페이지로');
    const bad = [
      { destination: 'mail' },
      { destination: 'page' },
      { destination: 'task', page_id: 'page-1' },
      { destination: 'chat', agent_id: null, instruction: '' },
      { destination: 'chat', instruction: '요약' }, // 담당이 있으면: 대화는 대표가 맡는다
      { deliver: 'html' },
      { destination: 'chat', agent_id: null, instruction: '요약', deliver: 'pdf' },
      { rules: 'x'.repeat(Schedule.RULES_MAX + 1) },
      { trigger: 'github' },
      { trigger: 'after' },
      { after_id: 'other' },
    ];
    for (const more of bad) assert.throws(() => daily(more), RuleViolation, JSON.stringify(more));
    const chat = daily({
      destination: 'chat',
      agent_id: null,
      instruction: '주간 보고',
      deliver: 'html',
    });
    assert.deepEqual([chat.destination, chat.deliver], [Schedule.CHAT, 'html']);
    assert.throws(
      () => chat.configure(settings({ trigger: 'after', after_id: chat.id }), NOW),
      /자기 뒤/,
    );
  });

  test('손 · 다른 레시피 뒤는 시각으로 깨우지 않는다. 뒤 레시피는 켜져 있을 때 한도 안에서만 돈다', () => {
    const manual = daily({ trigger: 'manual' });
    assert.equal(manual.unsaved.next_run_at, null);
    assert.equal(manual.dueAt(at('2026-11-07T00:00:00Z')), false);
    assert.equal(manual.follow(NOW), null, '계기가 after가 아니면 따라 돌지 않는다');
    const after = daily({ trigger: 'after', after_id: 'other', daily_max: 1 });
    assert.equal(after.unsaved.next_run_at, null);
    assert.deepEqual(after.follow(NOW), NOW);
    assert.equal(after.follow(NOW), null, '하루 한도');
    assert.equal(daily({ trigger: 'after', after_id: 'other', enabled: false }).follow(NOW), null);
  });

  test('대화 레시피: 연 대화를 기억하고, 받을 것을 바꿔도 그 대화에 남는다 (O-4). 대화가 아닌 곳으로 보내면 놓는다', () => {
    const recipe = settings({ destination: 'chat', agent_id: null, instruction: '주간 보고' });
    const chat = daily(recipe);
    chat.openedChat('chat-1');
    chat.configure({ ...recipe, title: '이름만 바꿈' }, NOW);
    assert.equal(chat.chatId, 'chat-1');
    chat.configure({ ...recipe, deliver: 'html' }, NOW);
    assert.equal(chat.chatId, 'chat-1', '받을 것은 회차마다 싣는다');
    chat.configure({ ...recipe, destination: 'task' }, NOW);
    assert.equal(chat.chatId, null);
  });

  test('일을 만든 레시피: 작업의 request_id · 회차의 요청에서', () => {
    const id = '0193f5a2-0000-7000-8000-000000000001';
    assert.equal(Schedule.sourceOf(`schedule:${id}:2026-11-06T00:00:00.000Z`), id);
    assert.equal(Schedule.sourceOf(`chat:${id}:1`), null);
    assert.equal(Schedule.sourceOf(null), null);
  });
});
