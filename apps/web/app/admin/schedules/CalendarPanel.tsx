'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';
import { TASK_STATUS } from '../../_task/labels';
import { TASK_TOPICS } from '../../_task/live';
import type { ScheduleCalendar } from '../../_task/types';

const WEEK = ['월', '화', '수', '목', '금', '토', '일'];
const DAY_MS = 86_400_000;
/** 하루 칸에 보이는 줄. 넘으면 "+N" */
const PER_DAY = 3;

/** 그날 0시 (이 브라우저 시간대) */
const startOf = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate());
const dayKey = (at: Date) => `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`;
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

/** 보이는 달의 칸: 그달 1일이 든 주의 월요일부터 6주 */
function gridOf(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const back = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - back);
  return Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

type Line = {
  key: string;
  at: string;
  title: string;
  tone: 'planned' | 'done' | 'failed' | 'open';
  href: string | null;
};

/** 하루에 보일 줄: 돌 시각(예정)과 지난 실행(상태), 시각 순 */
function linesOf(data: ScheduleCalendar | null): Map<string, Line[]> {
  const days = new Map<string, Line[]>();
  const add = (line: Line) => {
    const key = dayKey(new Date(line.at));
    days.set(key, [...(days.get(key) ?? []), line]);
  };
  for (const p of data?.planned ?? [])
    add({
      key: `p:${p.scheduleId}:${p.at}`,
      at: p.at,
      title: p.title,
      tone: 'planned',
      href: null,
    });
  for (const r of data?.runs ?? [])
    add({
      key: `r:${r.taskId}`,
      at: r.at,
      title: `${r.title.replace(/ \(.*\)$/, '')} · ${TASK_STATUS[r.status] ?? r.status}`,
      tone: r.status === 'done' ? 'done' : r.status === 'failed' ? 'failed' : 'open',
      href: r.chatId ? `/admin/chats/${r.chatId}` : `/admin/tasks/${r.taskId}`,
    });
  for (const list of days.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  return days;
}

// 스케줄 캘린더 (2026-11-27, 사용자 "스케줄은 캘린더 형태로 나타내서 캘린더에 맞춰서 일을 등록해둘 수도 있나?").
// 한 달 칸에 매일 · 한 번 스케줄이 돌 시각과 지난 실행(완료 · 실패 · 도는 중)을 보인다. N시간 · N분마다는 칸마다 펼치지 않고 위에 한 줄.
// 오늘 이후의 날짜를 누르면 그날 오전 9시의 한 번 실행으로 새 스케줄을 연다 (onPick). 날짜는 이 브라우저 시간대로 묶는다.
export function CalendarPanel({ onPick }: { onPick: (day: Date) => void }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const grid = gridOf(month);
  const from = grid[0] as Date;
  const to = new Date((grid[41] as Date).getTime() + DAY_MS);
  const calendar = useLiveValue(
    `schedule-calendar:${from.toISOString()}`,
    () =>
      api<ScheduleCalendar>(
        'GET',
        `/api/schedules/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      ),
    [...TASK_TOPICS, 'task.schedule.changed'],
  );
  const days = linesOf(calendar.data);
  const today = startOf(new Date()).getTime();
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const repeating = calendar.data?.repeating ?? [];

  return (
    <section className="calendar" aria-label="스케줄 캘린더">
      <div className="row calendar-head">
        <button type="button" className="ghost small" onClick={() => shift(-1)} aria-label="지난달">
          ‹
        </button>
        <b>
          {month.getFullYear()}년 {month.getMonth() + 1}월
        </b>
        <button type="button" className="ghost small" onClick={() => shift(1)} aria-label="다음 달">
          ›
        </button>
      </div>
      {repeating.length > 0 && (
        <small className="note">
          자주 도는 것:{' '}
          {repeating
            .map(
              (r) =>
                `${r.title} (${r.mode === 'hourly' ? `${r.everyHours}시간` : `${r.everyMinutes}분`}마다)`,
            )
            .join(' · ')}
        </small>
      )}
      {calendar.error && <p className="error">{calendar.error}</p>}
      <table className="calendar-grid">
        <thead>
          <tr>
            {WEEK.map((w) => (
              <th key={w} scope="col">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4, 5].map((week) => (
            <tr key={week}>
              {grid.slice(week * 7, week * 7 + 7).map((day) => {
                const lines = days.get(dayKey(day)) ?? [];
                const past = day.getTime() < today;
                const other = day.getMonth() !== month.getMonth();
                return (
                  <td
                    key={day.toISOString()}
                    className={`calendar-day${other ? ' other' : ''}${day.getTime() === today ? ' today' : ''}`}
                  >
                    {past ? (
                      <span className="calendar-date">{day.getDate()}</span>
                    ) : (
                      <button
                        type="button"
                        className="calendar-date"
                        title="이날 한 번 실행할 일 등록"
                        onClick={() => onPick(day)}
                      >
                        {day.getDate()}
                      </button>
                    )}
                    {lines.slice(0, PER_DAY).map((line) =>
                      line.href ? (
                        <Link
                          key={line.key}
                          href={line.href}
                          className={`calendar-line ${line.tone}`}
                        >
                          {clock(line.at)} {line.title}
                        </Link>
                      ) : (
                        <span key={line.key} className={`calendar-line ${line.tone}`}>
                          {clock(line.at)} {line.title}
                        </span>
                      ),
                    )}
                    {lines.length > PER_DAY && (
                      <small className="note">+{lines.length - PER_DAY}</small>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <small className="note">
        오늘 이후 날짜를 누르면 그날 할 일을 등록해요 (한 번 돌고 꺼져요)
      </small>
    </section>
  );
}
