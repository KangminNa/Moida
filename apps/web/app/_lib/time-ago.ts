// 지난 때를 "얼마나 됐는지"로: 마지막 연결 · 마지막 접근 · 마지막 쓰임처럼 시각보다 지난 길이로 판단하는 값에 쓴다.
// 30일이 넘으면 날짜로 (그쯤이면 날짜가 더 읽기 쉽다). 정확한 시각이 필요한 곳은 `_task/labels`의 when
export function ago(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  const minutes = Math.floor((now - at.getTime()) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days}일 전`;
  return at.toLocaleDateString('ko-KR', { dateStyle: 'medium' });
}
