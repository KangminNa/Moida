import { WEEKDAY_LABELS } from './labels';

// 스케줄 주기 한 줄 (목록 · 대화의 자동화 칩). labels.ts가 길어 나눴다 (2026-11-27, 한 번 실행 더함)
/** 스케줄 주기를 한 줄로: "매일 09:30 · 평일", "6시간마다", "15분마다", 꺼져 있으면 "꺼짐", 손으로만 · 앞 레시피 뒤 */
export function scheduleLabel(schedule: {
  enabled: boolean;
  trigger: string;
  mode: string;
  atTime: string | null;
  weekdays: readonly number[];
  everyHours: number | null;
  everyMinutes?: number | null;
  runAt?: string | null;
}): string {
  if (schedule.trigger === 'manual') return '손으로';
  if (!schedule.enabled) return '꺼짐';
  if (schedule.trigger === 'after') return '앞 레시피 뒤';
  if (schedule.mode === 'hourly') return `${schedule.everyHours}시간마다`;
  if (schedule.mode === 'minutely') return `${schedule.everyMinutes}분마다`;
  if (schedule.mode === 'once')
    return schedule.runAt
      ? `한 번 · ${new Date(schedule.runAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      : '한 번';
  const days = schedule.weekdays.join(',');
  const which =
    days === '1,2,3,4,5,6,7'
      ? ''
      : days === '1,2,3,4,5'
        ? ' · 평일'
        : ` · ${schedule.weekdays.map((d) => WEEKDAY_LABELS[d]).join('')}`;
  return `매일 ${schedule.atTime}${which}`;
}
