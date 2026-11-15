import type { UsageAgent } from './types';

// 작업·승인·에이전트의 화면 이름과 표시 형식

export const TASK_STATUS: Record<string, string> = {
  queued: '차례 기다리는 중',
  running: '일하는 중',
  waiting: '승인 대기',
  done: '완료',
  failed: '실패',
  cancelled: '취소',
};

/** 기다리는 작업이 무엇을 기다리는지 (서버의 Task.WAIT_*) */
export const WAIT_LABELS: Record<string, string> = {
  approval: '승인 대기',
  subtasks: '팀원 기다리는 중',
};

/** 작업 상태의 이름. 기다리는 중이면 무엇을 기다리는지까지 */
export function taskStatusLabel(status: string, waitReason: string | null = null): string {
  if (status === 'waiting' && waitReason) return WAIT_LABELS[waitReason] ?? '승인 대기';
  return TASK_STATUS[status] ?? status;
}

/** 취소할 수 있는 상태 (서버의 Task.cancel과 맞춘다) */
export const CANCELLABLE: readonly string[] = ['queued', 'running', 'waiting'];

export const APPROVAL_STATUS: Record<string, string> = {
  pending: '대기',
  approved: '승인',
  revision_requested: '수정 요청',
  rejected: '반려',
  cancelled: '취소',
};

export const PUBLISH_POST = 'blog.post.publish';
export const RAISE_LIMIT = 'task.agent.raise_limit';
/** browser-tabs 패키지의 승인된 클릭: AI가 멈춘 마지막 버튼을 러너가 붙잡아 올린다. 승인하면 러너가 같은 버튼인지 보고 누른다 */
export const PUBLISH_SITE = 'browser.site.publish';
/** browser-tabs 패키지의 로그인 필요: 콘솔 화면에서 로그인한 뒤 "로그인했어요"(수정 요청)로 같은 작업을 잇는다 */
export const LOGIN_SITE = 'browser.site.login';
/** "로그인했어요"가 보내는 수정 요청의 말 */
export const LOGGED_IN_NOTE = '로그인했어요';
/** code-github 패키지의 PR 머지 승인 (주인이 GitHub에서 머지한 뒤 승인) */
export const MERGE_PULL = 'code.pr.merge';
/** 외부 도구 꽂기 (2차 7단계): AI가 제안한 도구를 붙이는 승인. 승인하면 켜고 제안한 에이전트에 붙인다 */
export const PLUG_TOOL = 'task.tool.plug';

/** 목표 실행의 승인: 다음 회차로 갈지, 목표 실행을 완료로 닫을지 (서버의 Approval.GOAL_*) */
export const GOAL_CONTINUE = 'task.goal.continue';
export const GOAL_COMPLETE = 'task.goal.complete';
/** 목표 실행 승인의 대상 종류 (서버의 Approval.GOAL_RUN) */
export const GOAL_RUN = 'goal_run';

/** 승인 버튼의 말이 다른 동작. 승인이 곧 실행인 것(누르기), 관리자가 직접 하는 것, 목표 실행의 다음 걸음 */
export const APPROVE_LABELS: Record<string, string> = {
  [PUBLISH_SITE]: '누르기',
  [MERGE_PULL]: '머지했어요',
  [GOAL_CONTINUE]: '다음 회차로',
  [GOAL_COMPLETE]: '완료로 닫기',
};

export const ACTION_LABELS: Record<string, string> = {
  [PUBLISH_POST]: '글 공개',
  [PUBLISH_SITE]: '브라우저 버튼 누르기',
  [LOGIN_SITE]: '로그인 필요',
  [MERGE_PULL]: 'PR 머지',
  [PLUG_TOOL]: '커넥터 붙이기',
  [RAISE_LIMIT]: '한도 변경',
  [GOAL_CONTINUE]: '목표 실행 중간 승인',
  [GOAL_COMPLETE]: '목표 실행 최종 승인',
  'task.chat.result': '결과 확인',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export const TARGET_LABELS: Record<string, string> = {
  post: '글',
  agent: '에이전트',
  browser_site: '사이트',
  browser_click: '브라우저 버튼',
  pull_request: 'PR',
  [GOAL_RUN]: '목표 실행',
  chat: '대화',
};

export const GOAL_RUN_STATUS: Record<string, string> = {
  running: '회차 진행 중',
  waiting: '승인 대기',
  done: '완료',
  stopped: '멈춤',
};

/** 승인을 올리는 때 (서버의 GoalRun.CHECKPOINTS) */
export const CHECKPOINTS: Record<string, string> = {
  every: '회차마다',
  milestone: '중요 단계마다',
  final: '끝에만',
};

export const EVENT_KINDS: Record<string, string> = {
  read: '읽기',
  write: '쓰기',
  result: '완료',
  error: '오류',
};

export const TOOL_LABELS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' };

/** 생각 강도 (2차 7단계). 빈 값은 CLI의 기본 */
export const EFFORT_LABELS: Record<string, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  xhigh: '매우 높음',
  max: '최대',
};

/** 참조의 종류 (보관함의 종류 · 주소) */
export const REF_KINDS: Record<string, string> = {
  wiki: '위키',
  session: '세션',
  post: '글',
  page: '페이지',
  output: '결과물',
  link: '스크랩',
  url: '주소',
};

/** 대화에서 고를 수 있는 모델 (Claude는 별칭, Codex는 직접 적는다. 빈 값은 에이전트의 설정) */
export const CLAUDE_MODELS: readonly (readonly [string, string])[] = [
  ['', '에이전트 설정'],
  ['opus', 'Opus'],
  ['sonnet', 'Sonnet'],
  ['haiku', 'Haiku'],
];

/** 도구마다 받는 생각 강도 (서버 AgentRuntime.EFFORTS와 맞춘다) */
export const TOOL_EFFORTS: Record<string, readonly string[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high'],
};

/** 팀 템플릿이 다 돌려면 필요한 것 (서버의 AgentTeamRow.needs) */
export const NEEDS_LABELS: Record<string, string> = {
  'code-runner': '샌드박스 필요 (만들기 · 코드)',
  'code-github': 'code-github 플러그인 필요',
  browser: '서버 브라우저 · browser-tabs 플러그인 필요',
};

/** ISO 요일 (월 1 ~ 일 7)의 이름 */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: '월',
  2: '화',
  3: '수',
  4: '목',
  5: '금',
  6: '토',
  7: '일',
};

/** 스케줄 주기를 한 줄로: "매일 09:30 · 평일", "6시간마다", 꺼져 있으면 "꺼짐", 손으로만 · 앞 레시피 뒤 */
export function scheduleLabel(schedule: {
  enabled: boolean;
  trigger: string;
  mode: string;
  atTime: string | null;
  weekdays: readonly number[];
  everyHours: number | null;
}): string {
  if (schedule.trigger === 'manual') return '손으로';
  if (!schedule.enabled) return '꺼짐';
  if (schedule.trigger === 'after') return '앞 레시피 뒤';
  if (schedule.mode === 'hourly') return `${schedule.everyHours}시간마다`;
  const days = schedule.weekdays.join(',');
  const which =
    days === '1,2,3,4,5,6,7'
      ? ''
      : days === '1,2,3,4,5'
        ? ' · 평일'
        : ` · ${schedule.weekdays.map((d) => WEEKDAY_LABELS[d]).join('')}`;
  return `매일 ${schedule.atTime}${which}`;
}

/** 목표 상태 (서버의 Goal.STATUSES와 맞춘다) */
export const GOAL_STATUS: Record<string, string> = {
  active: '진행 중',
  done: '달성',
  dropped: '중단',
};

/**
 * 나무를 위에서부터 펼친다 (목표, 조직도). 형제는 받은 순서 그대로, 부모를 찾을 수 없는 것은 맨 위로.
 * depth는 맨 위가 0
 */
export function flatTree<T extends { id: string }>(
  items: readonly T[],
  parentOf: (item: T) => string | null,
): { item: T; depth: number }[] {
  const ids = new Set(items.map((i) => i.id));
  const out: { item: T; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const item of items) {
      const up = parentOf(item);
      const top = up === null || !ids.has(up);
      if ((parent === null ? !top : up !== parent) || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push({ item, depth });
      visit(item.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

/** 구독 사용률의 창 */
export const WINDOW_LABELS: Record<string, string> = { five_hour: '5시간', seven_day: '7일' };

/** 쉬는 에이전트의 표시. 쉬는지는 서버가 정하고, 여기서는 왜인지만 고른다 */
export function holdLabel(agent: UsageAgent | undefined): string | null {
  if (!agent?.holding) return null;
  const tokensFull = agent.fiveHourLimit !== null && agent.fiveHourTokens >= agent.fiveHourLimit;
  return `쉬는 중 · ${tokensFull ? '5시간 한도' : '구독 사용률'}`;
}

/** 시각 (오늘이 아니면 날짜까지) */
export function when(iso: string): string {
  const at = new Date(iso);
  const today = at.toDateString() === new Date().toDateString();
  return at.toLocaleString(
    'ko-KR',
    today
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false },
  );
}

/** 시작한 뒤 지난 시간 (now는 화면이 다시 그릴 때의 시각) */
export function elapsed(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분째`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분째`;
}

/** 실행 로그의 시:분 */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 토큰 수. 1만이 넘으면 만 단위로 */
export function tokens(n: number): string {
  if (n < 10_000) return n.toLocaleString('ko-KR');
  const man = n / 10_000;
  return `${(Number.isInteger(man) ? man : Math.round(man * 10) / 10).toLocaleString('ko-KR')}만`;
}

/** 결과물의 종류 (서버 OutputPolicy.KINDS) */
export const OUTPUT_KINDS: Record<string, string> = {
  document: '문서',
  slides: '슬라이드',
  sheet: '표',
  image: '이미지',
  video: '영상',
  other: '기타',
};

/** 미리 보기를 열 수 있는 형식 (서버가 앞부분으로 확인한 것만 inline을 준다: OutputPolicy.canInline) */
export const INLINE_MIMES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
];

/** 글자로 미리 볼 수 있는 형식 (내려받아 글자로만 보인다) */
export const TEXT_MIMES: readonly string[] = [
  'text/markdown',
  'text/plain',
  'text/csv',
  'text/tab-separated-values',
];

/** 바이트를 사람이 읽는 크기로 */
export function bytes(n: number): string {
  if (n < 1024) return `${n}B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}${units[unit]}`;
}

/** 대화의 상태 (상태판의 state: 마지막 회차로 정한다) */
export const CHAT_STATE: Record<string, string> = {
  routing: '맡길 곳 찾는 중',
  asking: '질문',
  working: '일하는 중',
  waiting_approval: '승인',
  done: '끝남',
  failed: '실패',
};

/** 나에게 온 것: 목록에서 채운 표시로 (질문 · 승인). 나머지는 테두리 */
export const CHAT_NEEDS_ME: readonly string[] = ['asking', 'waiting_approval'];

/** 대화의 소식 종류 (task.chat_updates.kind) */
export const NEWS_KINDS: Record<string, string> = {
  member_done: '팀원 끝남',
  member_failed: '팀원 실패',
  progress: '중간 보고',
  decision: '정한 것',
  assumption: '가정',
  appended: '덧붙인 말',
  reply: '짧은 답',
  final: '최종 답',
  failed: '실패',
  review: '검토',
  question: '질문',
  routed: '맡음',
};

/** 레시피의 어디로 (schedules.destination) */
export const DESTINATION_LABELS: Record<string, string> = {
  task: '작업',
  chat: '대화',
  page: '페이지',
};

/** 레시피의 계기 (schedules.trigger) */
export const TRIGGER_LABELS: Record<string, string> = {
  time: '정한 시각',
  manual: '손으로만',
  after: '다른 레시피가 끝난 뒤',
};

/** 대화의 받을 것 (chats.deliver). 비우면 대화 답 */
export const DELIVER_LABELS: Record<string, string> = {
  html: 'HTML 페이지',
  blog: '블로그 글',
  browser: '브라우저 동작',
  code: '코드 (PR)',
};
