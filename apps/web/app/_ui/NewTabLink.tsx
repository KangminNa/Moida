import type { ReactNode } from 'react';

// 새 탭으로 여는 링크 (웹 UX U3): 다른 사이트, 콘솔에서 연 공개 화면 · 결과물 보기.
// rel="noopener noreferrer": 열린 쪽이 연 창(콘솔)을 바꿔치기하지 못하고, 주소가 Referer로 새지 않게.
// 사이트 안 이동은 이것을 쓰지 않고 같은 탭으로 (Link · a)
export function NewTabLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
