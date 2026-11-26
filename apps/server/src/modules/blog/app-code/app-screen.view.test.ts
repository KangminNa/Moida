import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import type { AppRow, IssueRow, MenuRow } from '../blog.tables';
import { AppScreenDataView } from './app-screen.view';

// 데이터 약속 cairn: 1 (docs/스토어.md 9.3)의 이름은 러너의 앱 코드 검사(apps/runner/src/app-code-check.ts의 NAMES)가
// 모두 알아야 한다: 모르는 이름은 "약속에 없는 이름"으로 AI에게 다시 고치게 한다. 약속에 이름을 더하면 그 목록에도 더한다.

const NOW = new Date('2026-11-18T00:00:00Z');
/**
 * 웹이 더하는 이름 (글 본문의 html · 날짜 글자 · 사이트 이름, 커뮤니티의 글 · 댓글 · 회원 칸: 스토어 3-2)과
 * 웹이 빼는 이름 (md 본문)
 */
const WEB_ADDS = [
  'html',
  'dateText',
  'name',
  ...['topics', 'topic', 'author', 'nickname', 'comments', 'edited', 'mine'],
  ...['editUrl', 'commentUrl', 'reportUrl', 'community', 'open', 'member'],
  ...['loginUrl', 'joinUrl', 'meUrl', 'writeUrl'],
];
const WEB_DROPS = ['body'];

const app = {
  id: 'a1',
  space_id: 's1',
  kind: 'magazine',
  name: '카페',
  slug: 'cafe',
  description: '',
  visibility: 'public',
  sort: 0,
  icon_blob_hash: 'abcdef0123456789',
  version: 1,
  created_at: NOW,
  updated_at: NOW,
  code_seq: null,
  code_pending_seq: null,
  code_versions: 0,
  policy: '',
  home: false,
  domain: null,
  domain_checked_at: null,
  code_manifest: {},
} satisfies AppRow;
const menu = {
  id: 'm1',
  space_id: 's1',
  name: '호',
  slug: 'issues',
  sort: 0,
  version: 1,
  kind: 'issues',
  policy: '',
  rss: true,
  created_at: NOW,
  updated_at: NOW,
  app_id: 'a1',
} satisfies MenuRow;
const issue = {
  id: 'i1',
  space_id: 's1',
  title: '1호',
  intro: '창가',
  created_at: NOW,
  menu_id: 'm1',
  number: 1,
  status: 'published',
  published_at: NOW,
  version: 1,
  updated_at: NOW,
} satisfies IssueRow;
const post = { slug: 'p', title: '글', excerpt: '', tags: ['a'], published_at: NOW };

/** 객체 · 목록을 끝까지 내려가며 모은 키 */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysOf(v, into);
  else if (value !== null && typeof value === 'object')
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  return into;
}

describe('앱 화면 데이터의 이름 (cairn: 1)', () => {
  test('모든 화면의 데이터 이름을 러너의 앱 코드 검사가 안다', () => {
    const view = (screen: string) =>
      new AppScreenDataView(screen, app, '/cafe', [app, { ...app, id: 'a2' }], [menu], true);
    const screens = [
      view('home').withPosts([post], 'next').withIssues([issue]).withIssue(issue, [post]),
      view('post').withArticle({
        ...post,
        align: 'center',
        status: 'published',
        body: '본문',
        menu_slug: null,
      }),
      view('menu').withMenu(menu).withPosts([post], null),
      view('menu').withMenu(menu).withIssues([issue]),
      view('issue').withMenu(menu).withIssue(issue, [post]),
      view('home').withPages([{ name: 'map', title: '지도', updated_at: NOW }]),
      view('topic'),
      view('view').withView('about'),
      view('missing'),
    ];
    const used = new Set<string>(WEB_ADDS);
    for (const s of screens) for (const key of keysOf(s.toJSON())) used.add(key);
    for (const key of WEB_DROPS) used.delete(key);

    const source = readFileSync(
      resolve(__dirname, '../../../../../runner/src/app-code-check.ts'),
      'utf8',
    );
    const list = /NAMES: readonly string\[\] = \[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
    const known = new Set([...list.matchAll(/'(\w+)'/g)].map((m) => m[1]));
    assert.ok(known.size > 20, '러너의 NAMES 목록을 읽지 못했어요');
    assert.deepEqual(
      [...used].filter((key) => !known.has(key)),
      [],
      '러너의 AppCodeCheck.NAMES에 더해 주세요',
    );
  });
});

describe('앱 도메인의 주소 (스토어 3-0)', () => {
  const blog = { ...app, id: 'a2', kind: 'blog' as const, name: '블로그', slug: 'blog' };
  const linked = {
    ...blog,
    id: 'a3',
    slug: 'shop',
    domain: 'shop.example.com',
    domain_checked_at: NOW,
  };
  const unchecked = { ...blog, id: 'a4', slug: 'wait', domain: 'wait.example.com' };
  const posts = { ...menu, kind: 'posts' as const, slug: 'notes' };

  test('앱 도메인으로 연 화면: 앱 주소는 도메인의 뿌리, 기본 도메인에 있는 것은 사이트 주소로', () => {
    const own = { ...blog, domain: 'blog.example.com', domain_checked_at: NOW };
    const site = 'https://cairn.example.com';
    const data = new AppScreenDataView(
      'home',
      own,
      '',
      [own, linked, unchecked],
      [posts],
      true,
      site,
    )
      .withPosts([post], 'next')
      .withPages([{ name: 'map', title: '지도', updated_at: NOW }])
      .toJSON();
    assert.equal(data.base, '/', '템플릿의 첫 화면 링크(href="{{base}}")');
    assert.equal(data.files, '/files');
    assert.equal(data.app.url, '/');
    assert.equal(data.app.rssUrl, '/rss.xml');
    assert.equal(data.menus[0]?.url, '/m/notes');
    assert.equal(data.posts[0]?.url, '/posts/p');
    assert.equal(data.more?.url, '/?cursor=next');
    assert.deepEqual(data.site, {
      home: `${site}/`,
      store: `${site}/store`,
      loginUrl: `${site}/login`,
      graphUrl: `${site}/graph`,
    });
    assert.equal(data.pages[0]?.url, `${site}/pages/map/`);
    assert.deepEqual(
      data.others.map((a) => a.url),
      ['https://shop.example.com/', `${site}/wait`],
      '확인한 도메인은 그 도메인, 확인 전이면 기본 도메인의 /<slug>',
    );
  });

  test('기본 도메인으로 연 화면: 지금과 같고, 연결을 확인한 도메인의 앱만 그 도메인으로', () => {
    const data = new AppScreenDataView(
      'home',
      blog,
      '/blog',
      [blog, linked, unchecked],
      [posts],
      true,
    )
      .withPosts([post], null)
      .toJSON();
    assert.equal(data.base, '/blog');
    assert.equal(data.files, '/blog/files');
    assert.equal(data.app.rssUrl, '/blog/rss.xml');
    assert.equal(data.site.home, '/');
    assert.deepEqual(
      data.others.map((a) => a.url),
      ['https://shop.example.com/', '/wait'],
    );
  });

  test('미리 보기 토큰 주소에서도 RSS는 토큰 없이', () => {
    const data = new AppScreenDataView('home', blog, '/blog/~tok', [blog], [posts], false).toJSON();
    assert.equal(data.base, '/blog/~tok');
    assert.equal(data.app.url, '/blog/~tok');
    assert.equal(data.app.rssUrl, '/blog/rss.xml');
  });
});
