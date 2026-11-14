'use client';

import { WEEKDAY_LABELS } from '../../_task/labels';
import type { Schedule } from '../../_task/types';

/** N시간마다에서 고를 수 있는 값: 하루를 나누어떨어지게 하는 수 */
const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12, 24];
const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** 주기 칸의 값: 매일(시각 · 요일) 또는 N시간마다 */
export type Period = {
  mode: string;
  atTime: string;
  weekdays: readonly number[];
  everyHours: number;
};

/** 스케줄에서 주기 칸의 처음 값 */
export function periodOf(schedule: Schedule | null): Period {
  return {
    mode: schedule?.mode ?? 'daily',
    atTime: schedule?.atTime ?? '09:00',
    weekdays: schedule?.weekdays ?? DAYS,
    everyHours: schedule?.everyHours ?? 4,
  };
}

/** 보낼 본문의 주기 칸: 매일이면 시각 · 요일, N시간마다면 간격만 */
export function periodBody(period: Period) {
  return period.mode === 'daily'
    ? { mode: period.mode, atTime: period.atTime, weekdays: period.weekdays }
    : { mode: period.mode, everyHours: period.everyHours };
}

// 계기가 "정한 시각"인 레시피의 주기 칸 (매일 정한 시각 · N시간마다). 그리는 조각이라 값은 폼이 든다.
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
        </select>
      </div>
      {value.mode === 'daily' ? (
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
      ) : (
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
