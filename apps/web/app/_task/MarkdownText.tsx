'use client';

import '../_blog/blog.css';
import { useMemo } from 'react';
import { renderMarkdown } from '../_lib/markdown';

/**
 * AI가 쓴 md 글 (작업의 결과, 대화의 답). 본문의 HTML은 그리지 않고 결과도 거른다 (_lib/markdown.ts).
 * 글이 같으면 다시 바꾸지 않는다: 대화는 신호마다 다시 그려져 회차가 많으면 모든 답을 매번 다시 바꿨다 (2026-11-24 속도)
 */
export function MarkdownText({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className="prose"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown이 거른 HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
