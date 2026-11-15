import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type TidySessionRow, TidySettings } from './tidy-settings';

const SPACE = '00000000-0000-7000-8000-000000000001';
const SESSION = '00000000-0000-7000-8000-000000000002';
const NOW = new Date('2026-11-01T00:00:00Z');

const session = (title = '로그인 고치기'): TidySessionRow => ({
  node_id: SESSION,
  head_title: title,
  revision_count: 3,
  version: 7,
});
const settingsOf = (autoTidy: boolean, cadence = 'save', dailyAt: Date | null = null) =>
  TidySettings.restore({
    id: SPACE,
    space_id: SPACE,
    auto_tidy: autoTidy,
    cadence,
    daily_at: dailyAt,
    version: 1,
    updated_at: NOW,
  });

describe('정리 일 요청', () => {
  test('일 요청의 칸: 판마다 requestId가 다르고 task를 몰라도 된다', () => {
    const settings = settingsOf(true);
    settings.sessionSaved(session(), 3);
    const [event, ...rest] = settings.pullEvents();
    assert.equal(rest.length, 0);
    assert.equal(event?.name, 'task.task.requested');
    assert.deepEqual(event?.data, {
      requestId: `tidy:${SESSION}:3`,
      kind: 'tidy_session',
      title: '세션 정리: 로그인 고치기',
      targetKind: 'session',
      targetId: SESSION,
      baseVersion: 7,
    });
  });

  test('꺼져 있으면 저장 뒤 요청이 없다. 행이 없어도 꺼짐이다', () => {
    const off = settingsOf(false);
    off.sessionSaved(session(), 3);
    assert.equal(off.pullEvents().length, 0);
    const absent = TidySettings.absent(SPACE);
    absent.sessionSaved(session(), 3);
    assert.equal(absent.pullEvents().length, 0);
    assert.equal(absent.version, 0);
  });

  test('쌓인 세션은 꺼져 있어도 요청하고 지금 판 번호를 쓴다', () => {
    const settings = TidySettings.absent(SPACE);
    settings.backlog([session()]);
    const [event] = settings.pullEvents();
    assert.equal(event?.data.requestId, `tidy:${SESSION}:3`);
    assert.deepEqual(settings.unsaved, {}, '요청은 설정을 바꾸지 않는다');
  });

  test('제목이 없거나 길어도 작업 제목의 상한 안에 든다', () => {
    const settings = TidySettings.absent(SPACE);
    settings.backlog([session(''), session('ㄱ'.repeat(500))]);
    const [untitled, long] = settings.pullEvents();
    assert.equal(untitled?.data.title, '세션 정리: 제목 없음');
    assert.equal(String(long?.data.title).length, 200);
  });
});

describe('하루 한 번 몰아서 (2차 7단계)', () => {
  const HOUR = 60 * 60 * 1000;

  test('하루 한 번이면 저장할 때 요청하지 않는다. 새로 켜면 기본이 하루 한 번', () => {
    const daily = settingsOf(true, 'daily');
    daily.sessionSaved(session(), 3);
    assert.equal(daily.pullEvents().length, 0);
    const fresh = TidySettings.absent(SPACE);
    fresh.turn(true, null, NOW);
    assert.equal(fresh.daily, true);
  });

  test('차례는 켜졌고 하루 한 번이고 지난 차례에서 23시간이 지났을 때', () => {
    assert.equal(settingsOf(true, 'daily').dueDaily(NOW), true, '처음');
    const ran = new Date(NOW.getTime() - 22 * HOUR);
    assert.equal(settingsOf(true, 'daily', ran).dueDaily(NOW), false);
    const old = new Date(NOW.getTime() - 23 * HOUR);
    assert.equal(settingsOf(true, 'daily', old).dueDaily(NOW), true);
    assert.equal(settingsOf(false, 'daily').dueDaily(NOW), false, '꺼짐');
    assert.equal(settingsOf(true, 'save').dueDaily(NOW), false, '저장할 때마다');
  });

  test('차례에서 세션마다 요청하고 그때를 적는다 (세션이 없어도)', () => {
    const settings = settingsOf(true, 'daily');
    settings.ranDaily([session()], NOW);
    assert.equal(settings.pullEvents()[0]?.data.requestId, `tidy:${SESSION}:3`);
    assert.deepEqual(settings.unsaved, { daily_at: NOW });
    const empty = settingsOf(true, 'daily');
    empty.ranDaily([], NOW);
    assert.equal(empty.dueDaily(NOW), false);
  });

  test('언제는 save · daily만', () => {
    assert.throws(() => settingsOf(true).turn(true, 'hourly', NOW));
    const settings = settingsOf(true, 'save');
    settings.turn(true, 'daily', NOW);
    assert.equal(settings.daily, true);
  });
});
