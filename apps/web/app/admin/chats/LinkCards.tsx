'use client';

import { api } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';
import type { LinkPreview } from '../../_task/types';
import { NewTabLink } from '../../_ui/NewTabLink';

// 링크 미리보기 카드 (F3, 2026-11-21): 답에 있는 http(s) 주소 앞의 MAX개를 서버가 읽은 사이트 · 제목 · 설명 · 대표 그림으로.
// 서버가 대신 열고(read_url과 같은 안전 규칙: 내부망 막기 · 크기 · 시간 한도, 하루 기억) 그림도 서버를 거친다:
// 관리자의 브라우저가 바깥 사이트에 직접 닿지 않는다. 읽지 못한 주소는 카드를 그리지 않는다 (링크는 답 안에 그대로 있다)
const MAX = 3;
const URLS = /https?:\/\/[^\s<>()[\]{}"'`]+/g;

/** 답에 나온 순서대로, 끝의 문장 부호를 떼고 겹치지 않게 MAX개 */
function linksOf(text: string): string[] {
  const found = (text.match(URLS) ?? []).map((u) => u.replace(/[.,;:!?…]+$/u, ''));
  return [...new Set(found)].filter((u) => URL.canParse(u)).slice(0, MAX);
}

export function LinkCards({ text }: { text: string }) {
  const links = linksOf(text);
  if (links.length === 0) return null;
  return (
    <div className="link-cards">
      {links.map((url) => (
        <LinkCard key={url} url={url} />
      ))}
    </div>
  );
}

function LinkCard({ url }: { url: string }) {
  const q = encodeURIComponent(url);
  const { data } = useLiveValue(
    `link-preview:${url}`,
    () => api<LinkPreview>('GET', `/api/link-preview?url=${q}`),
    [],
  );
  if (!data || (!data.title && !data.description && !data.image)) return null;
  return (
    <NewTabLink href={url} className="link-card">
      {data.image && (
        // biome-ignore lint/performance/noImgElement: 서버가 받아 준 미리보기 그림이라 Next의 이미지 최적화를 거치지 않는다
        <img src={`/api/link-preview/image?url=${q}`} alt="" loading="lazy" />
      )}
      <span className="link-card-text">
        <span className="note">{data.site}</span>
        <b>{data.title || url}</b>
        {data.description && <span className="link-card-desc">{data.description}</span>}
      </span>
    </NewTabLink>
  );
}
