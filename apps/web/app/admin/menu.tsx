// 콘솔 왼쪽 메뉴. 메뉴 하나 = app/admin/<주소>/ 폴더 하나 + 여기 한 줄. 기능이 생길 때 더한다.
// 대화가 처음 화면이다 (2차 1-5). 왼쪽 아래에는 늘 승인 · 팀 · 보관함 · 설정 네 줄이 있고 (MAIN_MENU),
// 설정 칸에서는 설정 묶음과 접어 둔 "고급"이 보인다 (MENU, 2026-11-15 화면 정리: 설정은 대화에서 하고 화면은 덜어 둔다).
// 아이콘은 흑백 이모지다: 이모지 모양을 흑백 글꼴(Noto Emoji)로 그려 흑백 디자인을 지킨다.

/** 아이콘 이름 → 흑백 이모지. 끝의 ︎는 글자 모양으로 그리라는 표시 (색 이모지로 바뀌지 않게) */
const ICONS: Readonly<Record<string, string>> = {
  new: '✏︎',
  chat: '\u{1F4AC}︎',
  approve: '✅︎',
  team: '\u{1F465}︎',
  box: '\u{1F5C2}︎',
  gear: '⚙︎',
  key: '\u{1F511}︎',
  lock: '\u{1F512}\uFE0E',
  site: '\u{1F310}︎',
  bell: '\u{1F514}︎',
  user: '\u{1F464}︎',
  goal: '\u{1F3AF}︎',
  clock: '⏰︎',
  task: '\u{1F4CB}︎',
  session: '\u{1F5D2}︎',
  book: '\u{1F4DA}︎',
  graph: '\u{1F578}︎',
  post: '\u{1F4DD}︎',
  compass: '\u{1F9ED}︎',
  plug: '\u{1F50C}︎',
  runner: '\u{1F5A5}︎',
  device: '\u{1F4BB}︎',
  brick: '\u{1F9F1}︎',
  puzzle: '\u{1F9E9}︎',
  wrench: '\u{1F6E0}︎',
  office: '\u{1F3E2}︎',
  code: '\u2328\uFE0E',
  tools: '\u{1F9F0}︎',
  warn: '\u26A0\uFE0E',
  back: '←',
};

export const CHAT_HREF = '/admin';
export const CHATS_HREF = '/admin/chats';
export const APPROVALS_HREF = '/admin/approvals';
/** 팀: 에이전트 · 조직도 · 팀 템플릿. 이 제품의 핵심 설정 */
export const TEAM_HREF = '/admin/agents';
/** 보관함 (2차 5단계): 결과물 · 페이지 · 읽은 글 · 세션 · 위키 · 글을 한 목록으로. 결과물 · 페이지 · 스크랩 관리는 그 아래 */
export const LIBRARY_HREF = '/admin/library';
/** 설정의 첫 화면: AI 계정 */
export const SETTINGS_HREF = '/admin/ai';

/** 대화 칸 (2차 1-5): 새 대화와 대화 하나 (/admin/chats/<id>). 왼쪽은 대화 목록이라 이 줄들은 메뉴로 그리지 않는다 */
export const CHAT_MENU = [
  { href: CHAT_HREF, name: '새 대화', icon: 'new' },
  { href: CHATS_HREF, name: '대화', icon: 'chat' },
];

/** 늘 보이는 네 줄: 대화 칸에서는 목록 아래, 설정 칸에서는 맨 위 */
export const MAIN_MENU = [
  { href: APPROVALS_HREF, name: '승인', icon: 'approve' },
  { href: TEAM_HREF, name: '팀', icon: 'team' },
  { href: LIBRARY_HREF, name: '보관함', icon: 'box' },
  { href: SETTINGS_HREF, name: '설정', icon: 'gear' },
];

/** 설정 칸의 묶음. advanced는 "고급" 안에 접어 둔다 (대화로 하게 될 것 · 직접 손볼 때만 쓰는 것) */
export const MENU = [
  {
    label: '설정',
    advanced: false,
    items: [
      { href: SETTINGS_HREF, name: 'AI 계정', icon: 'key' },
      { href: '/admin/external-tools', name: '커넥터', icon: 'plug' },
      { href: '/admin/site', name: '사이트', icon: 'site' },
      { href: '/admin/notices', name: '알림', icon: 'bell' },
      { href: '/admin/account', name: '계정', icon: 'user' },
      { href: '/admin/security', name: '보안', icon: 'lock' },
    ],
  },
  {
    label: '일',
    advanced: true,
    items: [
      { href: '/admin/goals', name: '목표', icon: 'goal' },
      { href: '/admin/schedules', name: '스케줄', icon: 'clock' },
      { href: '/admin/tasks', name: '작업 기록', icon: 'task' },
      { href: '/admin/events', name: '처리 실패', icon: 'warn' },
    ],
  },
  {
    label: '지식 · 블로그',
    advanced: true,
    items: [
      { href: '/admin/sessions', name: '세션', icon: 'session' },
      { href: '/admin/wiki', name: '위키', icon: 'book' },
      { href: '/admin/graph', name: '지식 그래프', icon: 'graph' },
      { href: '/admin/posts', name: '글', icon: 'post' },
      { href: '/admin/menus', name: '블로그 메뉴', icon: 'compass' },
    ],
  },
  {
    label: '연결',
    advanced: true,
    items: [
      { href: '/admin/runners', name: '러너', icon: 'runner' },
      { href: '/admin/devices', name: '연결된 기기', icon: 'device' },
      { href: '/admin/plugins', name: '플러그인', icon: 'brick' },
      { href: '/admin/skills', name: '스킬', icon: 'puzzle' },
      { href: '/admin/tool-texts', name: 'MCP 도구 설명', icon: 'wrench' },
      { href: '/admin/office', name: '오피스', icon: 'office' },
    ],
  },
];

/** 기능 패키지가 목록 파일에 적은 묶음(옛 이름 포함) → 지금 묶음. 모르는 묶음은 "고급"의 맨 아래 */
export const PACKAGE_GROUPS: Readonly<Record<string, string>> = {
  운영: '일',
  자동화: '일',
  일: '일',
  지식: '지식 · 블로그',
  블로그: '지식 · 블로그',
  연결: '연결',
  설정: '설정',
};

/** 위쪽 줄의 제목: 지금 주소가 속한 메뉴 (설정 칸은 "설정 › 이름"). 모르면 null */
export function titleOf(pathname: string | null): { section: string | null; name: string } | null {
  if (!pathname) return null;
  if (pathname === CHAT_HREF) return { section: null, name: '새 대화' };
  if (pathname.startsWith(`${CHATS_HREF}/`)) return { section: null, name: '대화' };
  const main = MAIN_MENU.find((m) => m.href !== SETTINGS_HREF && pathname.startsWith(m.href));
  if (main) return { section: null, name: main.name };
  for (const group of MENU)
    for (const item of group.items)
      if (pathname.startsWith(item.href)) return { section: '설정', name: item.name };
  return null;
}

export function MenuIcon({ name }: { name: string }) {
  return (
    <span className="menu-ico" aria-hidden="true">
      {ICONS[name] ?? ICONS.tools}
    </span>
  );
}
