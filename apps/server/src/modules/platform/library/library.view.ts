/**
 * 보관함의 한 줄 (2차 5단계). 내용을 가진 모듈이 자기 읽기에서 돌려주는 모양이다 (기반과 모듈 사이의 약속).
 * href: 콘솔 안에서 그것을 여는 경로, url: 바깥 주소(읽은 글 · 공개 페이지). visibility는 그 종류의 값 그대로.
 * place: 놓인 곳의 이름 (platform은 무엇인지 모른다)
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
  /** 놓인 곳 (2차 6단계: 글 · 페이지를 올린 블로그 메뉴)의 id와 이름. 없는 종류는 비운다 */
  placeId?: string | null;
  place?: string | null;
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
        placeId: r.placeId ?? null,
        place: r.place ?? null,
      })),
      next: this.next,
    };
  }
}

/** 보관함 일괄 지우기의 결과: 휴지통으로 보낸 수, 여기서 지우지 않는 종류 (그 화면에서) */
export class LibraryTrashedView {
  constructor(
    private readonly trashed: number,
    private readonly skipped: readonly string[],
  ) {}

  toJSON() {
    return { trashed: this.trashed, skipped: this.skipped };
  }
}
