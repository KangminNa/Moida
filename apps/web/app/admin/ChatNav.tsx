'use client';

import { CHAT_NEEDS_ME, CHAT_STATE, tokens } from '../_task/labels';
import { useChats } from '../_task/live';
import type { ChatSummary } from '../_task/types';
import { CHATS_HREF } from './menu';

/** 목록에 표시를 다는 상태 (끝난 대화는 표시 없이) */
const MARKED = ['routing', 'asking', 'working', 'waiting_approval', 'failed'];

// 대화 옆 칸의 목록 (2차 1-5, ChatGPT · Claude 같은 모양): 날짜별 대화. 위의 새 대화 · 접기 단추는 콘솔 틀이 그린다.
// 나에게 온 것(질문 · 승인)은 채운 표시, 일하는 중 · 실패는 테두리 표시. 누가 맡았는지는 대화 안에서만 보인다
export function ChatNav({ pathname }: { pathname: string | null }) {
  const list = useChats();
  const chats = list.data?.chats ?? null;
  return (
    <nav className="chat-nav" aria-label="대화">
      {list.error && <p className="error">{list.error}</p>}
      {chats === null ? (
        !list.error && <p className="label-mono">불러오는 중…</p>
      ) : chats.length === 0 ? (
        <p className="note">아직 대화 없음</p>
      ) : (
        daysOf(chats).map(([day, rows]) => (
          <section key={day} className="chat-day" aria-label={day}>
            <div className="console-label">{day}</div>
            {rows.map((c) => {
              const href = `${CHATS_HREF}/${c.id}`;
              return (
                <a
                  key={c.id}
                  className="chat-link"
                  href={href}
                  aria-current={pathname === href ? 'page' : undefined}
                  title={c.title}
                >
                  <span className="clamp-1">{c.title}</span>
                  {c.tokens > 0 && <small title="이 대화가 쓴 토큰">{tokens(c.tokens)}</small>}
                  {MARKED.includes(c.state) && (
                    <span className={CHAT_NEEDS_ME.includes(c.state) ? 'pill on' : 'pill'}>
                      {CHAT_STATE[c.state] ?? c.state}
                    </span>
                  )}
                </a>
              );
            })}
          </section>
        ))
      )}
    </nav>
  );
}

/** 마지막으로 말한 날로 묶는다: 오늘 · 어제 · 지난 7일 · 그 전 (목록은 이미 최근 것부터) */
function daysOf(chats: readonly ChatSummary[]): [string, ChatSummary[]][] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  const label = (iso: string) => {
    const at = new Date(iso).getTime();
    if (at >= start.getTime()) return '오늘';
    if (at >= start.getTime() - day) return '어제';
    if (at >= start.getTime() - 7 * day) return '지난 7일';
    return '그 전';
  };
  const groups = new Map<string, ChatSummary[]>();
  for (const c of chats) {
    const key = label(c.updatedAt);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()];
}
