// 앱 라이브러리의 목록 (2026-11-28, 사용자 "플러그인이나 기능들이 라이브러리 형태로 바로 사용"): moida.js가 주는 것 하나하나.
// 이 한 곳에서 둘을 만든다: 앱 코드의 타입(/_/moida.d.ts, moidaTypes)과 스킬 참고(skills/moida-make/references/library.md, libraryMarkdown).
// library.md는 이 목록에서 만든 그대로여야 한다 (moida-catalog.test.ts가 본다: 고치면 apps/web에서 `pnpm library`로 다시 만든다).
// plugin이 있는 것은 그 플러그인이 준다고 목록 파일(plugins/<이름>/moida-plugin.json의 client.provides)에 적은 것이다 (테스트가 맞춰 본다)

/** 라이브러리의 것 하나. use는 쓰는 법 한 줄, types는 moida.d.ts에 들어갈 선언 */
type LibraryEntry = {
  name: string;
  group: 'moida' | 'component';
  plugin: string | null;
  use: string;
  does: string;
  types: string;
};

const PLACE = `interface MoidaPlace { name: string; address?: string; category?: string; note?: string; lat?: number; lng?: number }`;

export const LIBRARY: readonly LibraryEntry[] = [
  {
    name: 'moida.open',
    group: 'moida',
    plugin: null,
    use: 'if (!moida.open) …',
    does: '회원 · 데이터를 쓸 수 있는 화면인가 (앱의 도메인으로 연 공개 화면). 거짓이면 안내를 그린다',
    types: 'readonly open: boolean;',
  },
  {
    name: 'moida.page',
    group: 'moida',
    plugin: null,
    use: 'moida.page',
    does: '이 화면 주소의 데이터 (화면에 실려 온 moida-data 블록, 없으면 null)',
    types: 'readonly page: { base?: string; [key: string]: unknown } | null;',
  },
  {
    name: 'moida.data',
    group: 'moida',
    plugin: null,
    use: "await moida.data('posts/<글>')",
    does: "그 주소의 데이터 ('' 첫 화면 · 'posts/<글>' · 'm/<메뉴>' · 'm/<메뉴>/<번호>'). 다른 공개 앱의 글이면 { redirect }",
    types: 'data(path?: string, cursor?: string): Promise<unknown>;',
  },
  {
    name: 'moida.me',
    group: 'moida',
    plugin: null,
    use: 'const { member } = await moida.me()',
    does: '로그인한 회원 (없으면 member가 null)',
    types:
      'me(): Promise<{ member: { nickname: string; loginId?: string; [key: string]: unknown } | null }>;',
  },
  {
    name: 'moida.login',
    group: 'moida',
    plugin: null,
    use: 'moida.login() · moida.join() · await moida.logout()',
    does: '가입 · 로그인은 Moida의 고정 화면이 한다 (비밀번호는 앱 코드를 거치지 않는다). 끝나면 지금 주소로 돌아온다',
    types: 'login(back?: string): void;\njoin(back?: string): void;\nlogout(): Promise<void>;',
  },
  {
    name: 'moida.from',
    group: 'moida',
    plugin: null,
    use: "await moida.from('표').select().eq('칸', 값).order('칸', 'desc').limit(10)",
    does: 'moida.json에 선언한 앱 데이터 표 읽기 → { rows, more }. 조건 eq neq gt gte lt lte, 내 줄만 .mine(). 쓰기 insert · update(id) · delete(id)',
    types: 'from(table: string): MoidaQuery;',
  },
  {
    name: 'moida.community',
    group: 'moida',
    plugin: null,
    use: 'await moida.community.write({ title, body })',
    does: '커뮤니티 글 · 댓글 · 신고: topics(cursor?) · topic(id) · write · edit · remove · comment · removeComment · report',
    types: 'readonly community: MoidaCommunity;',
  },
  {
    name: 'moida.map',
    group: 'moida',
    plugin: 'map',
    use: "const map = await moida.map.create('#map', { places, cluster: true, onSelect })",
    does: '지도 그리기 → { select(i), update(places), pinned() }. 찾기 search · geocode · reverse. 플러그인 map이 꺼져 있어도 OpenStreetMap으로 그린다',
    types: 'readonly map: MoidaMap;',
  },
  {
    name: '<moida-place-list>',
    group: 'component',
    plugin: 'map',
    use: '<moida-place-list src="places.json" cluster map-height="50vh"></moida-place-list>',
    does: '장소 앱 한 벌: 분류 칩 · 거르기 · 목록 ↔ 지도 고르기 · 지도를 못 그리면 목록과 지도 링크. src 대신 table="표"',
    types: "'moida-place-list': MoidaPlaceListElement;",
  },
  {
    name: '<moida-map>',
    group: 'component',
    plugin: 'map',
    use: '<moida-map src="places.json" map-height="320px"></moida-map>',
    does: '핀만 있는 지도 (목록 · 거르기 없이)',
    types: "'moida-map': MoidaElement;",
  },
  {
    name: '<moida-account>',
    group: 'component',
    plugin: null,
    use: '<moida-account></moida-account>',
    does: '로그인 전이면 로그인 · 가입, 로그인했으면 닉네임과 로그아웃. 격리된 화면에서는 안내 한 줄',
    types: "'moida-account': MoidaElement;",
  },
  {
    name: '<moida-rows>',
    group: 'component',
    plugin: null,
    use: '<moida-rows table="guestbook" order="created_at desc" limit="20"><template><p data-field="body"></p></template></moida-rows>',
    does: '앱 데이터 표의 줄마다 template을 복사해 data-field 칸에 값을 글자로 넣는다. mine이면 내 줄만, 다시 읽기는 요소.reload()',
    types: "'moida-rows': MoidaRowsElement;",
  },
];

const SHARED_TYPES = `${PLACE}
interface MoidaQuery extends PromiseLike<{ rows: Record<string, unknown>[]; more: boolean }> {
  select(): MoidaQuery;
  eq(column: string, value: unknown): MoidaQuery;
  neq(column: string, value: unknown): MoidaQuery;
  gt(column: string, value: unknown): MoidaQuery;
  gte(column: string, value: unknown): MoidaQuery;
  lt(column: string, value: unknown): MoidaQuery;
  lte(column: string, value: unknown): MoidaQuery;
  mine(): MoidaQuery;
  order(column: string, direction?: 'asc' | 'desc'): MoidaQuery;
  limit(n: number): MoidaQuery;
  offset(n: number): MoidaQuery;
  insert(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(id: string, values: Record<string, unknown>): Promise<Record<string, unknown>>;
  delete(id: string): Promise<null>;
}
interface MoidaCommunity {
  topics(cursor?: string): Promise<unknown>;
  topic(id: string): Promise<unknown>;
  write(topic: { title: string; body: string }): Promise<unknown>;
  edit(id: string, topic: { version: number; title: string; body: string }): Promise<unknown>;
  remove(id: string, version: number): Promise<null>;
  comment(topicId: string, body: string): Promise<unknown>;
  removeComment(id: string, version: number): Promise<null>;
  report(report: { topicId?: string; commentId?: string; reason: string; note?: string }): Promise<unknown>;
}
interface MoidaMapView {
  provider: 'osm' | 'kakao' | 'naver' | 'google';
  map: unknown;
  sdk: unknown;
  select(i: number): boolean;
  update(places: MoidaPlace[]): Promise<number>;
  pinned(): number[];
}
interface MoidaMap {
  readonly provider: 'osm' | 'kakao' | 'naver' | 'google';
  create(el: HTMLElement | string, options: { places: MoidaPlace[]; zoom?: number; cluster?: boolean; onSelect?(i: number, place: MoidaPlace): void }): Promise<MoidaMapView>;
  search(q: string, options?: { near?: { lat: number; lng: number }; size?: number }): Promise<{ places: (MoidaPlace & { id: string })[]; provider: string; attribution: string }>;
  geocode(address: string): Promise<(MoidaPlace & { id: string }) | null>;
  reverse(lat: number, lng: number): Promise<string | null>;
}
interface MoidaElement extends HTMLElement {}
interface MoidaPlaceListElement extends HTMLElement {
  addEventListener(type: 'moida:select', listener: (e: CustomEvent<{ index: number; place: MoidaPlace }>) => void): void;
  addEventListener(type: 'moida:ready', listener: (e: CustomEvent<{ places: MoidaPlace[]; pinned: number }>) => void): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}
interface MoidaRowsElement extends HTMLElement {
  reload(): Promise<void>;
}`;

function indent(text: string, by: string): string {
  return text
    .split('\n')
    .map((line) => by + line)
    .join('\n');
}

/** /_/moida.d.ts의 글자: 앱 코드가 `/// <reference path="…">`나 편집기로 쓰는 타입 */
export function moidaTypes(): string {
  const members = LIBRARY.filter((e) => e.group === 'moida').map((e) => e.types);
  const tags = LIBRARY.filter((e) => e.group === 'component').map((e) => e.types);
  return [
    '// moida.js의 타입 (Moida가 만든다). 쓸 수 있는 것의 설명: moida-make 스킬 references/library.md',
    SHARED_TYPES,
    'interface Moida {',
    indent(members.join('\n'), '  '),
    '}',
    'interface Window {',
    '  moida: Moida;',
    '}',
    'declare const moida: Moida;',
    'interface HTMLElementTagNameMap {',
    indent(tags.join('\n'), '  '),
    '}',
    '',
  ].join('\n');
}

function row(e: LibraryEntry): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  return `| \`${cell(e.name)}\` | \`${cell(e.use)}\` | ${cell(e.does)} | ${e.plugin ?? '기본'} |`;
}

/** skills/moida-make/references/library.md의 글자 */
export function libraryMarkdown(): string {
  const table = (group: LibraryEntry['group']) => [
    '| 이름 | 쓰는 법 | 하는 일 | 주는 곳 |',
    '|---|---|---|---|',
    ...LIBRARY.filter((e) => e.group === group).map(row),
  ];
  return [
    '# 앱 라이브러리 (moida.js)',
    '',
    '<!-- 만든 파일: apps/web/app/_blog/moida-catalog.ts에서 만든다. 직접 고치지 않는다 (apps/web에서 pnpm library) -->',
    '',
    '앱은 `<script src="_/moida.js"></script>` 한 줄로 아래를 모두 쓴다. 빌드 없이 그대로 돈다.',
    '타입은 같은 자리의 `_/moida.d.ts`. "주는 곳"이 플러그인이면 그 플러그인이 켜져 있을 때 일 지시의 "쓸 수 있는 라이브러리" 줄에 나온다.',
    '',
    '## 부품 (태그 한 줄)',
    '',
    '먼저 부품으로 짠다. 부품은 그림자 DOM 없이 그려 앱의 CSS가 그대로 먹고, 색 · 간격은 앱의 토큰(design.md의 `--accent` · `--space-*` …)을 쓴다.',
    "부품은 `moida:ready` · `moida:select` 알림(CustomEvent)을 낸다: `el.addEventListener('moida:select', (e) => e.detail.place)`.",
    '',
    ...table('component'),
    '',
    '## moida (스크립트)',
    '',
    '부품으로 안 되는 것만 직접 부른다. 실패하면 Error를 던진다 (status · code가 붙는다).',
    '',
    ...table('moida'),
    '',
    '## 장소 하나',
    '',
    '`{ name, address?, category?, note?, lat?, lng? }`. 좌표가 없으면 주소로 찾는다 (찾기를 켜지 않았거나 못 찾으면 목록에만).',
    '',
  ].join('\n');
}
