import type { Engine, UsageAgent } from './types';

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
  subtasks: '일꾼 기다리는 중',
  /** 일꾼이 ask_lead로 묻고 대표의 답을 기다림 (2026-11-24 대표 ↔ 일꾼 대화) */
  lead: '대표의 답 기다림',
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
/** 확인 필요 판단 (L3): 고를 안이 있는 승인. 고르면 그 안으로 일이 이어진다 */
export const DECIDE = 'task.decision';
/** 확인 필요의 까닭 (decision.confirm) */
export const CONFIRM_LABELS: Record<string, string> = {
  repeat_limit: '반복 한도',
  direction: '방향 바꿈',
  irreversible: '되돌리기 어려움',
};
/** 대화의 멈춤 기준 (L3, chats.stop_mode) */
export const STOP_LABELS: Record<string, string> = {
  all: '판단마다 멈춤',
  confirm: '확인 필요만 멈춤',
  end: '끝에서만 보기',
};
/** "로그인했어요"가 보내는 수정 요청의 말 */
export const LOGGED_IN_NOTE = '로그인했어요';
/** code-github 패키지의 PR 머지 승인 (주인이 GitHub에서 머지한 뒤 승인) */
export const MERGE_PULL = 'code.pr.merge';
/** 외부 도구 꽂기 (2차 7단계): AI가 제안한 도구를 붙이는 승인. 승인하면 켜고 제안한 에이전트에 붙인다 */
export const PLUG_TOOL = 'task.tool.plug';
/** API 커넥터 (2026-11-24): 일꾼이 낸 정의서로 REST API를 붙이거나 새 버전으로 바꾸는 승인 (서버가 올린다) */
export const PLUG_API = 'task.api.plug';
/** API 커넥터의 부르기 한 번: 바깥에 남기는 동작이거나 하루 한도를 넘었다 */
export const CALL_API = 'task.api.call';
/** 설정 바꾸기 (2026-11-15 C): AI가 propose_setting으로 올린 바꿀 값. 승인하면 서버가 바꾼다 */
export const SETTING_CHANGE = 'task.setting.change';
/** 코드 작업 열기 (2026-11-15 C, code-github 패키지): 승인하면 그 저장소에 코드 작업이 시작된다 */
export const START_CODE = 'code.task.start';
/** 앱 코드 공개 (스토어 1-6b): 대화의 만들기 일이 낸 확인 대기 버전. 대상은 앱, 판은 버전 번호 (서버의 Approval.APP_CODE_SHOW) */
export const SHOW_APP_CODE = 'blog.app_code.show';
/** 대화에서 요청한 배포 (2026-11-24): 관리자가 대화에 쓴 배포 · 수정 요청을 대표가 인용해 바로 승인된 기록 (서버의 Approval.PUBLISH_APP) */
export const PUBLISH_APP = 'blog.app.publish';
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
  [DECIDE]: '확인 필요 판단',
  [MERGE_PULL]: 'PR 머지',
  [PLUG_TOOL]: '커넥터 붙이기',
  [PLUG_API]: 'API 커넥터 붙이기',
  [CALL_API]: 'API 부르기',
  [SETTING_CHANGE]: '설정 바꾸기',
  [START_CODE]: '코드 작업 열기',
  'email.news.send': '가입자에게 소식 메일 보내기',
  [SHOW_APP_CODE]: '앱 코드 공개',
  [PUBLISH_APP]: '대화로 배포',
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
  api_connector: 'API 커넥터',
  api_call: 'API 부르기',
  browser_click: '브라우저 버튼',
  browser_click_plan: '누르기 계획',
  pull_request: 'PR',
  [GOAL_RUN]: '목표 실행',
  chat: '대화',
  schedule: '스케줄',
  goal: '목표',
  menu: '블로그 메뉴',
  app: '앱',
  /** 새로 만들기, 또는 공간에 하나인 설정(알림 · 사이트 · 세션 정리 …)의 바꾸기 (2026-11-15 D) */
  space: '공간',
  code_github_ask: '코드 작업 요청',
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

/** 엔진 이름 → 화면 이름 (엔진 목록 GET /api/ai/engines, 읽기 전이거나 목록에 없으면 이름 그대로) */
export function engineLabel(engines: readonly Engine[], name: string): string {
  return engines.find((e) => e.name === name)?.label ?? name;
}

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

/** 목표 상태 (서버의 Goal.STATUSES와 맞춘다) */
export const GOAL_STATUS: Record<string, string> = {
  active: '진행 중',
  done: '달성',
  dropped: '중단',
};

/**
 * 나무를 위에서부터 펼친다 (목표). 형제는 받은 순서 그대로, 부모를 찾을 수 없는 것은 맨 위로.
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

/** 기한까지 남은 때 (일꾼 기다리기: 지나면 다 끝나지 않아도 대표가 깬다) */
export function remaining(iso: string, now: number): string {
  const minutes = Math.ceil((new Date(iso).getTime() - now) / 60_000);
  if (minutes <= 0) return '기한 지남';
  if (minutes < 60) return `${minutes}분 남음`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 남음`;
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

/** 비율 (%). 조금이라도 있는데 반올림해 0이면 "1% 미만", 전체가 0이면 0% */
export function share(part: number, whole: number): string {
  const percent = whole > 0 ? Math.round((part / whole) * 100) : 0;
  return part > 0 && percent === 0 ? '1% 미만' : `${percent}%`;
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
  // 맡기 전 (O-2 전에 배정을 기다리던 대화): 다음 말을 보내면 대표가 맡는다
  asking: '맡기 전',
  working: '일하는 중',
  waiting_approval: '승인',
  done: '끝남',
  failed: '실패',
};

/** 나에게 온 것: 목록에서 채운 표시로 (맡기 전 · 승인). 나머지는 테두리 */
export const CHAT_NEEDS_ME: readonly string[] = ['asking', 'waiting_approval'];

/** 대화의 소식 종류 (task.chat_updates.kind) */
export const NEWS_KINDS: Record<string, string> = {
  member_done: '일꾼 끝남',
  member_failed: '일꾼 실패',
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

/** 받을 것 (대화 · 회차 · 레시피, O-3). 비우면 대표가 회차마다 정한다 */
export const DELIVER_LABELS: Record<string, string> = {
  answer: '짧은 답',
  file: '파일',
  html: '페이지 (HTML)',
  app_code: '앱 코드',
  blog: '블로그 글',
  browser: '브라우저 동작',
  code: '코드 (PR)',
  setting: '설정 · 자동화',
};
