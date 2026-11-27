'use client';

import { WEEKDAY_LABELS } from '../../_task/labels';
import type { Schedule } from '../../_task/types';

/** N시간마다에서 고를 수 있는 값: 하루를 나누어떨어지게 하는 수 */
const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
/** N분마다에서 고를 수 있는 값 (서버는 5~720분, 2026-11-20). 하루를 나누어떨어지게 하는 수 */
const EVERY_MINUTES = [5, 10, 15, 20, 30, 45, 90];
const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** 주기 칸의 값: 매일(시각 · 요일) · N시간마다 · N분마다 · 한 번(이 브라우저 시각 "YYYY-MM-DDTHH:mm", 2026-11-27 캘린더) */
export type Period = {
  mode: string;
  atTime: string;
  weekdays: readonly number[];
  everyHours: number;
  everyMinutes: number;
  runAt: string;
};

/** 순간 → datetime-local 칸의 값 (이 브라우저 시간대) */
export function localInput(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 스케줄에서 주기 칸의 처음 값 */
export function periodOf(schedule: Schedule | null): Period {
  return {
    mode: schedule?.mode ?? 'daily',
    atTime: schedule?.atTime ?? '09:00',
    weekdays: schedule?.weekdays ?? DAYS,
    everyHours: schedule?.everyHours ?? 4,
    everyMinutes: schedule?.everyMinutes ?? 30,
    runAt: schedule?.runAt ? localInput(new Date(schedule.runAt)) : '',
  };
}

/** 보낼 본문의 주기 칸: 매일이면 시각 · 요일, N시간 · N분마다면 간격만 */
export function periodBody(period: Period) {
  if (period.mode === 'once')
    return { mode: period.mode, runAt: period.runAt ? new Date(period.runAt).toISOString() : '' };
  if (period.mode === 'minutely') return { mode: period.mode, everyMinutes: period.everyMinutes };
  return period.mode === 'daily'
    ? { mode: period.mode, atTime: period.atTime, weekdays: period.weekdays }
    : { mode: period.mode, everyHours: period.everyHours };
}

/** 이 주기가 하루에 도는 횟수: 매일은 1, N시간마다는 시가 N으로 나누어떨어지는 정각, N분마다는 자정부터 N분 간격 */
export function runsPerDay(period: Period): number {
  if (period.mode === 'minutely') return Math.ceil(1440 / period.everyMinutes);
  if (period.mode === 'once') return 1;
  return period.mode === 'hourly' ? Math.ceil(24 / period.everyHours) : 1;
}

// 계기가 "정한 시각"인 레시피의 주기 칸 (매일 정한 시각 · N시간마다 · N분마다). 그리는 조각이라 값은 폼이 든다.
export function PeriodFields({
  id,
  value,
  onChange,
}: {
  /** 칸 id의 앞부분 (폼의 useId) */
  id: string;
  value: Period;
  onChange: (next: Period) => void;
}) {
  const set = (more: Partial<Period>) => onChange({ ...value, ...more });
  const toggleDay = (day: number) =>
    set({
      weekdays: value.weekdays.includes(day)
        ? value.weekdays.filter((d) => d !== day)
        : [...value.weekdays, day].sort(),
    });

  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-mode`}>주기</label>
        <select
          id={`${id}-mode`}
          className="input"
          value={value.mode}
          onChange={(e) => set({ mode: e.target.value })}
        >
          <option value="daily">매일 정한 시각</option>
          <option value="hourly">N시간마다</option>
          <option value="minutely">N분마다</option>
          <option value="once">한 번 (날짜 · 시각)</option>
        </select>
      </div>
      {value.mode === 'once' && (
        <div className="field">
          <label htmlFor={`${id}-run-at`}>날짜 · 시각</label>
          <input
            id={`${id}-run-at`}
            className="input"
            type="datetime-local"
            value={value.runAt}
            required
            onChange={(e) => set({ runAt: e.target.value })}
          />
          <small>그때 한 번 돌고 저절로 꺼져요. 캘린더에서 날짜를 눌러도 정해요</small>
        </div>
      )}
      {value.mode === 'minutely' && (
        <div className="field">
          <label htmlFor={`${id}-minutes`}>간격</label>
          <select
            id={`${id}-minutes`}
            className="input"
            value={value.everyMinutes}
            onChange={(e) => set({ everyMinutes: Number(e.target.value) })}
          >
            {EVERY_MINUTES.map((n) => (
              <option key={n} value={n}>
                {n}분마다
              </option>
            ))}
          </select>
          <small>
            시간대 기준 자정부터 N분 간격 (15분마다 → :00 · :15 · :30 · :45). 하루 한도도 그만큼
            올려야 하루 내내 돌아요
          </small>
        </div>
      )}
      {value.mode === 'daily' && (
        <>
          <div className="field">
            <label htmlFor={`${id}-at`}>시각</label>
            <input
              id={`${id}-at`}
              className="input"
              type="time"
              value={value.atTime}
              required
              onChange={(e) => set({ atTime: e.target.value })}
            />
          </div>
          <fieldset className="checks">
            <legend>요일</legend>
            {DAYS.map((day) => (
              <label key={day} className="check">
                <input
                  type="checkbox"
                  checked={value.weekdays.includes(day)}
                  onChange={() => toggleDay(day)}
                />
                {WEEKDAY_LABELS[day]}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {value.mode === 'hourly' && (
        <div className="field">
          <label htmlFor={`${id}-every`}>간격</label>
          <select
            id={`${id}-every`}
            className="input"
            value={value.everyHours}
            onChange={(e) => set({ everyHours: Number(e.target.value) })}
          >
            {EVERY_HOURS.map((n) => (
              <option key={n} value={n}>
                {n}시간마다
              </option>
            ))}
          </select>
          <small>
            시간대 기준 정각 중 시가 N으로 나누어떨어질 때 (4시간마다 → 0·4·8·12·16·20시)
          </small>
        </div>
      )}
    </>
  );
}
