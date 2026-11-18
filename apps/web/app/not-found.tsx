import './_blog/blog.css';

// 없는 페이지 (스토어 1-4). 비공개 앱의 주소(/<앱>/…)도 이 화면 · 같은 404라 앱이 있다는 사실이 드러나지 않는다 (원칙 5)
export default function NotFound() {
  return (
    <div className="blog">
      <main className="blog-main not-found">
        <p className="not-found-code">404</p>
        <h1>없는 페이지</h1>
        <a className="blog-more" href="/">
          첫 화면으로
        </a>
      </main>
    </div>
  );
}
