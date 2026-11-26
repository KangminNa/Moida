import { Icon } from '../_ui/Icon';
import { ChatCardForm } from './ChatCardForm';
import type { ChatCard } from './types';

/** 정한 결과 카드 하나: 정하기 직전의 카드(접히며 빠지는 모양)와 남길 한 줄 */
export type Settled = { card: ChatCard; text: string; kind: 'approve' | 'revise' | 'reject' };

/** 결과 카드의 결정 본문 (ChatCardForm이 보낸다) */
type DecideBody = { decision: string; note?: string; picked?: string[] };

// 결과 카드를 정한 뒤 (2026-11-26 콘솔 인터랙션 2): 카드가 접히며 빠지고 그 자리에 정한 것 한 줄이 남는다.
// 정한 카드는 서버에서 사라지므로(다시 읽으면 card가 null) 정하기 직전의 카드를 들고 있다가 한 번 접어 보인다.
// 대화 화면과 승인 화면(ChatCardApproval)이 함께 쓴다. 움직임 줄이기면 접지 않고 한 줄만 보인다 (globals.css)

/** 정한 내용을 한 줄로: 승인은 고른 동작 · 결과물 수와 정리한 수, 수정 요청 · 반려는 그 뜻 */
export function settledOf(card: ChatCard, body: DecideBody): Settled {
  if (body.decision === 'revise')
    return { card, kind: 'revise', text: '수정 요청함 · 메모를 다음 회차로 보냈어요' };
  if (body.decision !== 'approve')
    return { card, kind: 'reject', text: '반려함 · 카드의 동작은 실행하지 않아요' };
  const picked = new Set(body.picked ?? []);
  const chosen = card.items.filter((i) => picked.has(i.id));
  const actions = chosen.filter((i) => i.kind === 'action').length;
  const outputs = chosen.filter((i) => i.kind === 'output').length;
  const dropped = card.items.length - chosen.length;
  const parts = [
    actions > 0 ? `동작 ${actions}개 실행` : null,
    outputs > 0 ? `결과물 ${outputs}개 남김` : null,
    dropped > 0 ? `고르지 않은 ${dropped}개 정리` : null,
  ].filter((p): p is string => p !== null);
  return { card, kind: 'approve', text: ['승인함', ...parts].join(' · ') };
}

export function CardSettled({ settled }: { settled: Settled }) {
  return (
    <div className="card-settled" role="status">
      {/* 접히며 빠지는 카드: 누를 수 없고 읽는 기계에는 보이지 않는다 */}
      <div className="card-leaving" aria-hidden="true" inert>
        <div>
          <ChatCardForm card={settled.card} busy problem={null} onDecide={() => {}} />
        </div>
      </div>
      <p className={`card-settled-line ${settled.kind}`}>
        <span className="card-settled-mark">
          <Icon
            name={settled.kind === 'approve' ? 'check' : settled.kind === 'revise' ? 'back' : 'x'}
          />
        </span>
        {settled.text}
      </p>
    </div>
  );
}
