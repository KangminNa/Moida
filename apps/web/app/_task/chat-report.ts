import { renderMarkdown } from '../_lib/markdown';
import { OUTPUT_KINDS } from './labels';
import type { ChatDetail, ChatTurn } from './types';

// 대화 결과를 한 장짜리 HTML로 (2026-11-23, 사용자 요청 "작업의 대화의 결과물은 html로 항상 정리되어서"):
// 회차 하나의 맡긴 일 · 답 · 결과물을 바깥 파일 없이(글꼴 · 스크립트 없음, 스타일은 문서 안) 정리한다.
// 폭이 정해져 있어 그대로 이미지로 떠도 모양이 같고, 인쇄 · PDF로도 한 장씩 나온다.
// 답은 AI가 쓴 마크다운이라 renderMarkdown(rehype-sanitize)으로 거르고, 나머지 글자는 모두 이스케이프한다.
// 이 문서는 격리 머리글(스크립트 없음, next.config의 REPORT_HEADERS)과 함께 나간다.

const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f4f5; color: #18181b;
    font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif;
    word-break: keep-all; overflow-wrap: anywhere; }
  .report { width: 720px; max-width: 100%; margin: 32px auto; padding: 40px 44px; background: #fff;
    border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .kicker { margin: 0 0 6px; color: #71717a; font-size: 13px; letter-spacing: .02em; }
  h1 { margin: 0 0 8px; font-size: 26px; line-height: 1.35; }
  .meta { margin: 0 0 28px; color: #71717a; font-size: 13px; }
  h2 { margin: 28px 0 10px; padding-top: 20px; border-top: 1px solid #e4e4e7; color: #52525b; font-size: 13px;
    font-weight: 600; letter-spacing: .02em; }
  .ask { margin: 0; padding: 14px 16px; border-radius: 10px; background: #f4f4f5; white-space: pre-wrap; }
  .answer h1, .answer h2, .answer h3 { margin: 22px 0 8px; padding: 0; border: 0; color: #18181b; font-size: 18px; letter-spacing: 0; }
  .answer h3 { font-size: 16px; }
  .answer p, .answer ul, .answer ol { margin: 0 0 12px; }
  .answer a, .files a { color: #3f3fbf; }
  .answer blockquote { margin: 0 0 12px; padding: 2px 14px; border-left: 3px solid #d4d4d8; color: #52525b; }
  .answer code { padding: 1px 5px; border-radius: 4px; background: #f4f4f5; font-size: .9em; }
  .answer pre { overflow-x: auto; padding: 12px 14px; border-radius: 8px; background: #f4f4f5; font-size: 13px; line-height: 1.5; }
  .answer pre code { padding: 0; background: none; }
  .answer table { width: 100%; margin: 0 0 12px; border-collapse: collapse; font-size: 14px; }
  .answer th, .answer td { padding: 6px 8px; border-bottom: 1px solid #e4e4e7; text-align: left; vertical-align: top; }
  .answer th { color: #52525b; font-weight: 600; }
  .answer img { max-width: 100%; border-radius: 8px; }
  .files { margin: 0; padding: 0; list-style: none; }
  .files li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f4f4f5; }
  .files small, .empty { color: #71717a; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e4e4e7; color: #a1a1aa; font-size: 12px; }
  @media print { body { background: #fff; } .report { margin: 0 auto; box-shadow: none; } }
`;

/** 날짜와 시각 (한국어, 서울 시간) */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** 보여 줄 회차: 고른 번호, 없으면 답이 있는 마지막 회차. 없으면 null */
export function reportTurn(detail: ChatDetail, turn: number | null): ChatTurn | null {
  if (turn !== null) return detail.turns.find((t) => t.turn === turn) ?? null;
  return [...detail.turns].reverse().find((t) => t.reply) ?? null;
}

/** 내려받을 파일 이름: 대화 제목-회차.html (파일 이름에 못 쓰는 글자는 뺀다) */
export function reportFileName(detail: ChatDetail, turn: ChatTurn): string {
  const title = detail.chat.title.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim() || '대화';
  return `${title.slice(0, 60)}-${turn.turn}.html`;
}

/** 회차 하나의 결과 HTML. site는 결과물 · 대화로 가는 링크의 앞부분 (사이트 주소) */
export function chatReportHtml(detail: ChatDetail, turn: ChatTurn, site: string): string {
  const title = esc(detail.chat.title || '대화');
  const partner = detail.partner?.name ?? '대표';
  const when = stamp(turn.finishedAt ?? turn.createdAt);
  const answer = turn.reply
    ? renderMarkdown(turn.reply)
    : `<p class="empty">${turn.error ? `실패: ${esc(turn.error)}` : '아직 답이 없어요'}</p>`;
  const files = turn.outputs.length
    ? `<h2>결과물 ${turn.outputs.length}개</h2><ul class="files">${turn.outputs
        .map(
          (o) =>
            `<li><a href="${esc(`${site}/api/outputs/${o.id}/file?view=1`)}" target="_blank" rel="noopener noreferrer">${esc(o.name)}</a><small>${esc(OUTPUT_KINDS[o.kind] ?? o.kind)}</small></li>`,
        )
        .join('')}</ul>`
    : '';
  const chat = esc(`${site}/admin/chats/${detail.chat.id}`);
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ${turn.turn}번째</title><style>${STYLE}</style></head>
<body><article class="report">
<p class="kicker">Cairn · 대화 결과</p>
<h1>${title}</h1>
<p class="meta">${turn.turn}번째 회차 · ${esc(partner)} · ${esc(when)}</p>
<h2>맡긴 일</h2><p class="ask">${esc(turn.message)}</p>
<h2>결과</h2><div class="answer">${answer}</div>
${files}
<footer>대화 전체: <a href="${chat}" target="_blank" rel="noopener noreferrer">${chat}</a></footer>
</article></body></html>
`;
}
