import { APP_KIND_LABELS } from '../_blog/labels';
import { CONTENT_STATE_LABELS } from '../_community/labels';

// 설정 바꾸기 (2026-11-15 C · D)의 화면 문구: 설정 이름, 칸 이름과 값. 결과 카드 · 승인 화면의 바뀔 칸(ChangeLines)이 쓴다

/** 바꾸는 설정 (서버 propose_setting의 setting) */
export const SETTING_NAMES: Readonly<Record<string, string>> = {
  agent: '에이전트',
  schedule: '스케줄',
  goal: '목표',
  app: '앱',
  menu: '블로그 메뉴',
  site: '사이트',
  notice: '알림',
  tidy: '세션 정리',
  projects: '프로젝트별 모으기',
  plugin: '플러그인',
  moderation: '신고 검토',
};

/** 설정 바꾸기의 칸 이름 (서버 Edit의 SETTING.fields, get_settings와 같은 snake_case). 설정이 달라도 같은 이름은 같은 뜻이다 */
export const SETTING_FIELDS: Readonly<Record<string, string>> = {
  name: '이름',
  role: '역할',
  tool: 'AI 도구',
  model: '모델',
  effort: '생각 강도',
  scopes: '권한',
  approval_actions: '승인 동작',
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
  every_minutes: '몇 분마다',
  time_zone: '시간대',
  instruction: '지시',
  goal_id: '목표',
  page_id: '페이지',
  destination: '어디로',
  deliver: '받을 것',
  mail: '메일로 받기',
  rules: '지킬 것',
  trigger: '계기',
  after_id: '앞 레시피',
  daily_max: '하루 한도',
  description: '설명',
  parent_id: '상위 목표',
  sort: '순서',
  slug: '주소',
  kind: '종류',
  policy: '편집 방침',
  rss: 'RSS',
  digest: '모아 보내기',
  digest_time: '모아 보낼 시각',
  quiet_start: '조용한 시간 시작',
  quiet_end: '조용한 시간 끝',
  routes: '알림 경로',
  auto_tidy: '자동 정리',
  cadence: '정리 주기',
  collect: '모으기',
  menus: '시작 메뉴',
  app_id: '앱',
  target: '대상',
  state: '상태',
  open_reports: '열린 신고',
  blocked_until: '차단 끝',
};

/** 칸마다 따로 읽는 값 (켜고 끔 · 영어 값으로 읽으면 뜻이 틀리는 것). 키는 "칸" 또는 같은 칸 이름이 설정마다 뜻이 다르면 "설정.칸" */
const SETTING_VALUES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'app.kind': APP_KIND_LABELS,
  'moderation.state': CONTENT_STATE_LABELS,
  'moderation.target': { topic: '글', comment: '댓글', member: '회원' },
  'moderation.blocked_until': { forever: '기한 없음' },
};

/**
 * 바뀐 줄의 이름. 목록형 칸은 "칸.키"(routes.task.approval.requested · collect.blog)로 오고,
 * 화면이 모르는 이름(알림 종류 · 플러그인 칸)은 서버가 label로 함께 보낸다
 */
export function settingField(field: string, label?: string): string {
  const dot = field.indexOf('.');
  if (dot < 0) return label ?? SETTING_FIELDS[field] ?? field;
  const head = field.slice(0, dot);
  return `${SETTING_FIELDS[head] ?? head} · ${label ?? field.slice(dot + 1)}`;
}

/** 바뀔 값 한 칸을 글로 (빈 값 · 목록 · 켜고 끔, 칸마다 따로 읽는 값). 긴 글은 앞부분만 */
export function settingValue(value: unknown, field?: string, setting?: string | null): string {
  const own = field
    ? (SETTING_VALUES[`${setting}.${field}`] ?? SETTING_VALUES[field])?.[String(value)]
    : undefined;
  if (own) return own;
  if (value === null || value === undefined || value === '') return '없음';
  if (typeof value === 'boolean') return value ? '켬' : '끔';
  if (Array.isArray(value)) return value.length === 0 ? '없음' : value.join(' · ');
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
