/**
 * 보관함의 한 줄 (2차 5단계). 내용을 가진 모듈이 자기 읽기에서 돌려주는 모양이다 (기반과 모듈 사이의 약속).
 * href: 콘솔 안에서 그것을 여는 경로, url: 바깥 주소(읽은 글 · 공개 페이지). visibility는 그 종류의 값 그대로
 */
export interface LibraryRow {
  kind: string;
  id: string;
  title: string;
  project: string | null;
  at: Date;
  href: string;
  url: string | null;
  visibility: string;
}

/** 보관함 한 쪽 (주인만). 종류와 상관없이 최근 것부터, next가 있으면 ?cursor=next로 다음 쪽 */
export class LibraryPageView {
  constructor(
    private readonly rows: readonly LibraryRow[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return {
      items: this.rows.map((r) => ({
        kind: r.kind,
        id: r.id,
        title: r.title,
        project: r.project,
        at: r.at.toISOString(),
        href: r.href,
        url: r.url,
        visibility: r.visibility,
      })),
      next: this.next,
    };
  }
}
