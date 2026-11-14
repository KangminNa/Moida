import { postPath } from './format';
import type { PostSummary } from './types';

// RSS 2.0 한 벌 (블로그 전체 /rss.xml, 메뉴 /m/<주소>/rss.xml). 글은 발행한 순서로 서버의 목록 한 쪽(20개)이다.

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

function item(post: PostSummary, site: string): string {
  const link = xml(`${site}${postPath(post.slug)}`);
  return [
    '    <item>',
    `      <title>${xml(post.title)}</title>`,
    `      <link>${link}</link>`,
    `      <guid isPermaLink="true">${link}</guid>`,
    post.publishedAt ? `      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>` : '',
    `      <description>${xml(post.excerpt)}</description>`,
    ...post.tags.map((t) => `      <category>${xml(t)}</category>`),
    '    </item>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 피드 응답. site: 블로그 주소(끝 / 없이), page: 이 피드가 가리키는 화면(/ · /m/<주소>), self: 피드 자신의 경로 */
export function rssResponse(feed: {
  site: string;
  title: string;
  description: string;
  page: string;
  self: string;
  posts: readonly PostSummary[];
}): Response {
  const { site } = feed;
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xml(feed.title)}</title>`,
    `    <link>${xml(`${site}${feed.page === '/' ? '' : feed.page}`)}</link>`,
    `    <description>${xml(feed.description)}</description>`,
    '    <language>ko</language>',
    `    <atom:link href="${xml(`${site}${feed.self}`)}" rel="self" type="application/rss+xml"/>`,
    ...feed.posts.map((p) => item(p, site)),
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
