import { ChatTrashPanel } from '../ChatTrashPanel';

export const metadata = { title: '대화 휴지통 · Moida', robots: { index: false } };

// 대화 휴지통 (2026-11-19 휴지통 A): 휴지통으로 보낸 대화와 복원. 왼쪽 대화 목록 아래의 "휴지통"으로 온다
export default function ChatTrashPage() {
  return (
    <section className="console-inner narrow" aria-label="대화 휴지통">
      <header className="page-head">
        <h1>대화 휴지통</h1>
      </header>
      <ChatTrashPanel />
    </section>
  );
}
