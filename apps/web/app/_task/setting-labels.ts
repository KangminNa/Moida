// 설정 바꾸기 (2026-11-15 C)의 화면 문구: 칸 이름과 값. 결과 카드 · 승인 화면의 바뀔 칸(ChangeLines)이 쓴다

/** 설정 바꾸기의 칸 이름 (서버 SettingChanges.FIELDS, get_settings와 같은 snake_case) */
export const SETTING_FIELDS: Readonly<Record<string, string>> = {
  name: '이름',
  role: '역할',
  tool: 'AI 도구',
  model: '모델',
  effort: '생각 강도',
  scopes: '권한',
  approval_actions: '승인 동작',
  reports_to: '보고 대상',
  reviewer_id: '검토자',
  runner_id: '러너',
  external_tools: '커넥터',
  monthly_limit: '한 달 한도',
  five_hour_limit: '5시간 한도',
  plan_stop_percent: '구독 멈춤값',
  status: '상태',
  title: '제목',
  agent_id: '담당',
  enabled: '켜짐',
  mode: '주기',
  at_time: '시각',
  weekdays: '요일',
  every_hours: '몇 시간마다',
  time_zone: '시간대',
  instruction: '지시',
  goal_id: '목표',
  page_id: '페이지',
  destination: '어디로',
  deliver: '받을 것',
  rules: '지킬 것',
  trigger: '계기',
  after_id: '앞 레시피',
  daily_max: '하루 한도',
};

/** 바뀔 값 한 칸을 글로 (빈 값 · 목록 · 켜고 끔). 긴 글은 앞부분만 */
export function settingValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '없음';
  if (typeof value === 'boolean') return value ? '켬' : '끔';
  if (Array.isArray(value)) return value.length === 0 ? '없음' : value.join(' · ');
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
