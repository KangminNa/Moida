import { renderMarkdown } from '../_lib/markdown.ts';
import type { MemberMe, TopicDetail, TopicList } from './types';

// 커뮤니티 화면의 템플릿 데이터 (스토어 3-2, 약속 cairn: 1에 더하는 이름: skills/cairn-make/references/app-code.md).
// 서버의 블로그 화면 API는 틀(index · topic)만 주고, 글 · 댓글 · 회원은 웹이 회원 API로 읽어 여기서 템플릿 데이터로 바꾼다.
// 회원 정보는 최소한만 싣는다: 닉네임과 내 것인지(mine). 아이디 · 회원 id · 쓰기 확인 값은 앱 JS가 읽을 수 있어 싣지 않는다.
// 쓰기(가입 · 로그인 · 글 · 댓글 · 신고)는 템플릿이 아니라 Cairn이 그리는 고정 화면(/_/…)이 한다: 격리된 앱 화면에는 쿠키가 없다

/** 고정 화면의 주소 앞부분 (앱 도메인의 뿌리 아래) */
/** 고정 화면의 앞부분: 앱 안 주소의 '/_' (앱 도메인은 '/_', 공통 앱 도메인은 '/<앱>/_', 2026-11-27) */
function fixedOf(place: CommunityPlace): string {
  return `${place.base.replace(/\/$/, '')}/_`;
}

/** 지금 화면의 자리. open: 앱 도메인으로 연 화면이라 회원 기능이 열린다 (미리 보기 · 기본 도메인은 읽기만). here: 로그인 뒤 돌아올 곳 */
export type CommunityPlace = { base: string; open: boolean; here: string };

/** 앱 안 주소: base는 '/'(앱 도메인) · '/<앱>' · '/<앱>/~<토큰>'(기본 도메인) */
function inApp(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path}`;
}

/** 모든 커뮤니티 화면의 community: 회원 링크 (열리지 않은 화면에는 링크가 없다) */
export function communityOf(place: CommunityPlace, me: MemberMe | null) {
  if (!place.open)
    return {
      open: false,
      member: null,
      joinUrl: null,
      loginUrl: null,
      meUrl: null,
      writeUrl: null,
    };
  return {
    open: true,
    member: me?.member ? { nickname: me.member.nickname } : null,
    joinUrl: `${fixedOf(place)}/join`,
    loginUrl: `${fixedOf(place)}/login?return=${encodeURIComponent(place.here)}`,
    meUrl: `${fixedOf(place)}/me`,
    writeUrl: `${fixedOf(place)}/write`,
  };
}

/** 첫 화면의 topics · more (보이는 글, 최근부터 30개씩) */
export function topicsOf(list: TopicList | null, place: CommunityPlace) {
  const topics = (list?.topics ?? []).map((t) => ({
    title: t.title,
    excerpt: t.excerpt,
    url: inApp(place.base, `t/${t.id}`),
    date: t.createdAt,
    author: t.author,
    comments: t.comments,
  }));
  const next = list?.nextCursor ?? null;
  return {
    topics,
    more: next ? { url: `${place.base}?cursor=${encodeURIComponent(next)}` } : null,
  };
}

/** 글 화면의 topic: 본문 HTML(회원 글이라 바깥 링크에 nofollow ugc), 내 글이면 고치기, 열린 화면이면 댓글 · 신고 */
export function topicOf(topic: TopicDetail, place: CommunityPlace) {
  const { open } = place;
  const comments = topic.comments.map((c) => ({
    body: c.body,
    date: c.createdAt,
    author: c.author,
    mine: c.mine,
    reportUrl:
      open && !c.mine ? `${fixedOf(place)}/report?comment=${c.id}&topic=${topic.id}` : null,
  }));
  return {
    title: topic.title,
    html: renderMarkdown(topic.body, { ugc: true }),
    url: inApp(place.base, `t/${topic.id}`),
    date: topic.createdAt,
    edited: topic.editedAt !== null,
    author: topic.author,
    mine: topic.mine,
    editUrl: open && topic.mine ? `${fixedOf(place)}/write/${topic.id}` : null,
    commentUrl: open ? `${fixedOf(place)}/comment/${topic.id}` : null,
    reportUrl: open && !topic.mine ? `${fixedOf(place)}/report?topic=${topic.id}` : null,
    comments,
  };
}
