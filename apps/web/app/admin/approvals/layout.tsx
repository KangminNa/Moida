import type { ReactNode } from 'react';
import { ApprovalsList } from './ApprovalsList';

// 목록은 레이아웃에 둔다: 승인을 골라도 목록과 거르기, 읽은 쪽이 그대로다.
export default function ApprovalsLayout({ children }: { children: ReactNode }) {
  return (
    <section className="console-inner wide" aria-label="승인">
      <header className="page-head">
        <h1>승인</h1>
      </header>
      <ApprovalsList>{children}</ApprovalsList>
    </section>
  );
}
