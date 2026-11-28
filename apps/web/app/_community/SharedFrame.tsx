import '../_blog/blog.css';

// 공통 앱 도메인의 앱 없는 고정 화면 틀 (/_/login · /_/reset · /_/me, 2026-11-28): 머리의 사이트 이름(첫 화면으로)과 카드 하나
export function SharedFrame({
  site,
  title,
  children,
}: {
  site: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="blog">
      <header className="blog-top">
        <a className="blog-brand" href="/">
          {site}
        </a>
      </header>
      <main className="blog-main member-main">
        <section className="panel-card member-card" aria-label={title}>
          <h1>{title}</h1>
          {children}
        </section>
      </main>
    </div>
  );
}
