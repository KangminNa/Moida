import { SecurityEventsPanel } from './SecurityEventsPanel';
import { SecurityPanel } from './SecurityPanel';

export const metadata = { title: '보안 · Cairn', robots: { index: false } };

// 설정 › 보안 (2026-11-15): 보안 설정 값, 로그인한 곳 · 끝내기, 기기의 마지막 접근, 보안 기록 (로그인 시도 · 거부된 접근).
export default function SecurityPage() {
  return (
    <section className="console-inner" aria-label="보안">
      <SecurityPanel />
      <SecurityEventsPanel />
    </section>
  );
}
