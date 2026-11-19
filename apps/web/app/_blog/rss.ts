import { appPath, postPath } from './format';
import type { PostSummary, PublicApp } from './types';

// RSS 2.0 한 벌 (사이트 전체 /rss.xml, 앱 /<앱>/rss.xml, 메뉴 /<앱>/m/<주소>/rss.xml). 글은 발행한 순서로 서버의 목록 한 쪽(20개)이다.
// 주소는 모두 전체 주소다. 연결을 확인한 도메인이 있는 앱은 그 도메인으로 적는다 (스토어 3-0: 앱 도메인의 /rss.xml도 같은 피드).

/** XML 1.0에 넣을 수 없는 제어 문자 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 바로 이 글자들을 지우려는 식이다
const INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function xml(text: string): string {
  return text.replace(INVALID, '').replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

/** 앱의 바깥 주소 앞부분 (끝 / 없이): 연결을 확인한 도메인이면 https://<도메인>, 아니면 사이트 주소 + /<앱> */
export function appBase(app: Pick<PublicApp, 'slug' | 'url'>, site: string): string {
  return /^https?:\/\//.test(app.url) ? app.url.replace(/\/+$/, '') : `${site}${appPath(app.slug)}`;
}

/** 글의 전체 주소: 든 앱(공개 앱 목록에서 찾는다)의 바깥 주소 아래. 앱을 모르면 사이트의 고정 주소 */
export function postUrl(post: PostSummary, site: string, apps: readonly PublicApp[]): string {
  const app = apps.find((a) => a.slug === post.app?.slug);
  return app
    ? `${appBase(app, site)}/posts/${encodeURIComponent(post.slug)}`
    : `${site}${postPath(post.slug, post.app?.slug ?? null)}`;
}

function item(post: PostSummary, link: string): string {
  return [
    '    <item>',
    `      <title>${xml(post.title)}</title>`,
    `      <link>${xml(link)}</link>`,
    `      <guid isPermaLink="true">${xml(link)}</guid>`,
    post.publishedAt ? `      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>` : '',
    `      <description>${xml(post.excerpt)}</description>`,
    ...post.tags.map((t) => `      <category>${xml(t)}</category>`),
    '    </item>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 피드 응답. page: 이 피드가 가리키는 화면의 전체 주소, self: 피드 자신의 전체 주소, link: 글 하나의 전체 주소 */
export function rssResponse(feed: {
  title: string;
  description: string;
  page: string;
  self: string;
  posts: readonly PostSummary[];
  link: (post: PostSummary) => string;
}): Response {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xml(feed.title)}</title>`,
    `    <link>${xml(feed.page)}</link>`,
    `    <description>${xml(feed.description)}</description>`,
    '    <language>ko</language>',
    `    <atom:link href="${xml(feed.self)}" rel="self" type="application/rss+xml"/>`,
    ...feed.posts.map((p) => item(p, feed.link(p))),
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
  return new Response(body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
