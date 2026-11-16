// 독 화면 안의 탭 줄 (팀 › 작업 기록, 보관함 › 결과물 · 위키 …). 탭 하나 = 이미 있는 화면 하나라 링크로 둔다
export function SectionTabs({
  label,
  pages,
  current,
}: {
  label: string;
  pages: readonly { href: string; name: string }[];
  /** 지금 화면의 주소 (menu.tsx placeOf) */
  current: string | null;
}) {
  return (
    <nav className="section-tabs" aria-label={label}>
      {pages.map((p) => (
        <a
          key={p.href}
          className="section-tab"
          href={p.href}
          aria-current={p.href === current ? 'page' : undefined}
        >
          {p.name}
        </a>
      ))}
    </nav>
  );
}
