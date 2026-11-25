import { Icon } from '../_ui/Icon';
import type { ChatCard } from './types';

// 결과 카드의 검증 (검증 고리 V): 검토자 짝의 판정 · 완료 조건 체크리스트 · 고칠 것, 서버가 다시 맡긴 횟수.
// 판정을 읽지 못한 답(unknown)은 글 그대로 보인다. 완료 조건마다 1~5점이 있으면 함께 (2026-11-20 점수로 판정)

const VERDICT_LABELS: Record<string, string> = {
  pass: '그대로 승인',
  fix: '고칠 것 있음',
  reject: '반려 권함',
};

/** 서버의 ChatReview.PASS_SCORE · ChatResult.FIX_MAX · ChatReview.FIX_MAX: 통과 점수와 서버가 저절로 다시 맡기는 횟수의 한도 */
const PASS_SCORE = 4;
const DELIVER_FIX_MAX = 2;
const REVIEW_FIX_MAX = 1;

export function ChatCardReview({ card }: { card: ChatCard }) {
  const { review, fixed } = card;
  const auto = [
    fixed.deliver > 0 ? `받을 것 다시 맡김 ${fixed.deliver}/${DELIVER_FIX_MAX}번` : '',
    fixed.review > 0 ? `검토 반영 ${fixed.review}/${REVIEW_FIX_MAX}번` : '',
  ].filter(Boolean);
  if (!review && auto.length === 0) return null;
  const verdict = review ? VERDICT_LABELS[review.verdict] : undefined;
  return (
    <div className="result-review">
      <small>검토{auto.length > 0 ? ` · 자동으로 고침: ${auto.join(' · ')}` : ''}</small>
      {review && verdict && (
        <p className="result-verdict">
          <b>{verdict}</b>
          {review.score !== null ? ` · 평균 ${review.score}/5점 (${PASS_SCORE}점부터 통과)` : ''}
          {review.summary ? ` · ${review.summary}` : ''}
        </p>
      )}
      {review && !verdict && <p className="text">{review.summary}</p>}
      {review && review.checklist.length > 0 && (
        <ul className="result-checklist" aria-label="완료 조건">
          {review.checklist.map((line) => (
            <li key={line.item} className={line.ok ? '' : 'unmet'}>
              <Icon name={line.ok ? 'check' : 'x'} /> {line.item}
              {line.score !== null ? <small> · {line.score}/5점</small> : null}
              {line.note ? <small> · {line.note}</small> : null}
            </li>
          ))}
        </ul>
      )}
      {review && review.fixes.length > 0 && <small>고칠 것</small>}
      {review && review.fixes.length > 0 && (
        <ul className="result-checklist" aria-label="고칠 것">
          {review.fixes.map((fix) => (
            <li key={fix}>· {fix}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 항목을 낸 작업의 하네스 검사 한 줄 (없으면 null) */
export function checksLine(checks: ChatCard['items'][number]['checks']): string | null {
  if (!checks || checks.length === 0) return null;
  const passed = checks.filter((c) => c.ok).length;
  const retried = checks.some((c) => c.retried);
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return [
    `검사 ${checks.length}개 중 ${passed}개 통과`,
    retried ? '한 번 고쳐서 다시 검사' : '',
    failed.length > 0 ? `떨어짐: ${failed.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
