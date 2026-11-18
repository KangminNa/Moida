import type { ReactNode } from 'react';
import '../_blog/blog.css';

// 구독기가 사이트 주소만으로 RSS(공개 앱의 공개 글)를 찾게 한다
export const metadata = { alternates: { types: { 'application/rss+xml': '/rss.xml' } } };

// 공개 화면의 바탕 (스토어 1-4). 머리는 화면마다 다르다: 사이트 화면은 SiteHeader, 앱 화면은 [app]/layout의 AppShell
export default function BlogLayout({ children }: { children: ReactNode }) {
  return <div className="blog">{children}</div>;
}
