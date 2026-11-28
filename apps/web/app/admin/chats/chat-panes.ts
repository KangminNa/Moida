// 대화 화면 나누기 (2026-11-25 사용자 요청 "드래그해서 옆으로"): 옆 대화는 주소의 ?side=<대화 id>에 둔다.
// 주소에 두어 새로고침 · 뒤로 가기 · 북마크가 그대로 되고, 옆 칸의 너비만 이 브라우저에 기억한다.

/** 대화 목록 줄을 끌 때 싣는 값의 종류 (다른 것을 끌어 오면 놓을 자리를 보이지 않는다) */
export const CHAT_DRAG = 'application/x-moida-chat';

/** 옆 칸이 차지하는 몫: 처음 값과 끌어서 바꿀 수 있는 범위 */
export const SIDE_RATIO = { initial: 0.5, min: 0.3, max: 0.7 } as const;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_PATH = /^\/admin\/chats\/([^/]+)$/;

/** 지금 크게 보는 대화의 id (대화 하나 화면이 아니면 null) */
export function mainChatOf(pathname: string | null): string | null {
  return CHAT_PATH.exec(pathname ?? '')?.[1] ?? null;
}

/** 옆에 열 대화: 대화 id 모양이고, 크게 보는 대화와 다를 때만 */
export function sideChatOf(asked: string | null, main: string | null): string | null {
  return asked !== null && ID.test(asked) && asked !== main ? asked : null;
}

/** 옆 대화를 붙인 주소 (null이면 옆 칸 닫기) */
export function withSide(pathname: string, side: string | null): string {
  return side === null ? pathname : `${pathname}?side=${encodeURIComponent(side)}`;
}

/** 옆 칸 몫을 범위 안으로 (숫자가 아니면 처음 값) */
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SIDE_RATIO.initial;
  return Math.min(SIDE_RATIO.max, Math.max(SIDE_RATIO.min, ratio));
}
