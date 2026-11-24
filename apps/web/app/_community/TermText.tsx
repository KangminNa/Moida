import '../_blog/blog.css';
import { renderMarkdown } from '../_lib/markdown';
import type { Term } from './types';

/** 공개된 약관 하나 (3-4): 시행 버전 · 날짜와 본문. 아직 없으면 안내 */
export function TermText({ term }: { term: Term | null }) {
  if (!term) return <p className="rows-empty">아직 공개된 약관이 없어요</p>;
  const day = new Date(term.publishedAt).toLocaleDateString('ko-KR');
  return (
    <>
      <p className="member-hint">
        버전 {term.version} · {day}
      </p>
      <div
        className="prose"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown이 거른 HTML (관리자가 쓴 약관)
        dangerouslySetInnerHTML={{ __html: renderMarkdown(term.body) }}
      />
    </>
  );
}
