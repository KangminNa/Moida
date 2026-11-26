import { FailedEventsPanel } from './FailedEventsPanel';

export const metadata = { title: '처리 실패 · Moida', robots: { index: false } };

// 설정 › 일 › 처리 실패 (리팩토링 R1): 8번 실패해 멈춘 이벤트와 다시 시도.
export default function FailedEventsPage() {
  return (
    <section className="console-inner" aria-label="처리 실패">
      <FailedEventsPanel />
    </section>
  );
}
