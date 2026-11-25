'use client';

import Link from 'next/link';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';
import { useLiveValue } from '../_lib/use-live';
import { ChatCardForm } from './ChatCardForm';
import { CHAT_DETAIL_TOPICS } from './live';
import type { Approval, ChatDetail } from './types';

// 승인 화면에서 정하는 결과 카드 (2026-11-25 사용자 요청 "칸반에서 대화로 가지 않고 승인할 목록을 확인"):
// 그 대화를 읽어 카드의 항목 · 검토 판정 · 바뀐 점을 대화 화면과 같은 폼(ChatCardForm)으로 보이고, 여기서 고르고 승인한다.
// 대화가 다른 카드를 기다리면(이미 정했거나 새 회차) 대화로 가는 길만 둔다
export function ChatCardApproval({ approval }: { approval: Approval }) {
  const chatId = approval.target.id;
  const detail = useLiveValue(
    `chat-card:${chatId}`,
    () => api<ChatDetail>('GET', `/api/chats/${chatId}`),
    CHAT_DETAIL_TOPICS,
  );
  const deciding = useAction();
  const card = detail.data?.card ?? null;
  const toChat = <Link href={`/admin/chats/${chatId}`}>대화 열기</Link>;

  if (detail.data === null)
    return detail.error ? (
      <p className="error">{detail.error}</p>
    ) : (
      <p className="label-mono">결과 카드 불러오는 중…</p>
    );
  if (card === null || card.id !== approval.id)
    return <p className="note">대화의 결과 카드 · {toChat}</p>;

  const decide = (body: { decision: string; note?: string; picked?: string[] }) =>
    deciding.run(
      'decide',
      () => api('POST', `/api/approvals/${card.id}/decide`, { version: card.version, ...body }),
      {
        done: body.decision === 'approve' ? '고른 것만 남겼어요' : '정했어요',
        reload: detail.reload,
        conflict: '그사이 카드에 항목이 더해졌어요. 다시 골라요',
      },
    );

  return (
    <>
      <p className="note">
        {detail.data.chat.title} · {toChat}
      </p>
      <ChatCardForm
        key={`${card.id}:${card.version}`}
        card={card}
        busy={deciding.busy !== null}
        problem={deciding.problem}
        onDecide={decide}
      />
    </>
  );
}
