import type { IssueRow, PostRow } from '../blog.tables';

// 매거진 호의 읽기 모양 (2차 6단계). 웹이 `import type`으로 가져온다.
// 관리자는 상태 · 버전 · 글 수까지, 방문자는 발행한 호의 번호 · 제목 · 소개 · 발행일과 공개 글만.

/** 호 한 줄과 함께 읽는 칸: 든 글의 수 */
export interface IssueListRow extends IssueRow {
  posts: number;
}

/** 호 하나 (관리자) */
export class IssueView {
  constructor(
    private readonly row: Readonly<IssueRow>,
    private readonly posts: number,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      menuId: r.menu_id,
      number: r.number,
      title: r.title,
      intro: r.intro,
      /** draft(만드는 중) · published(발행) */
      status: r.status,
      posts: this.posts,
      publishedAt: r.published_at?.toISOString() ?? null,
      version: r.version,
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** 메뉴 하나의 호 목록 (관리자, 새 번호부터) */
export class IssueListView {
  constructor(private readonly rows: readonly Readonly<IssueListRow>[]) {}

  toJSON() {
    return { issues: this.rows.map((r) => new IssueView(r, Number(r.posts)).toJSON()) };
  }
}

/** 호에 든 글 한 줄 (관리자: 임시 글까지, 방문자: 공개 글만) */
export interface IssuePostRow
  extends Pick<PostRow, 'id' | 'slug' | 'title' | 'excerpt' | 'status'> {
  issue_order: number | null;
}

/** 호 하나와 글 (관리자의 호 화면) */
export class IssueDetailView {
  constructor(
    private readonly row: Readonly<IssueRow>,
    private readonly posts: readonly Readonly<IssuePostRow>[],
  ) {}

  toJSON() {
    return {
      ...new IssueView(this.row, this.posts.length).toJSON(),
      postList: this.posts.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title ?? '',
        status: p.status,
        order: p.issue_order,
      })),
    };
  }
}

/** 방문자가 보는 호: 발행한 호만, 글은 공개 글만 순서대로 */
export class PublicIssueView {
  constructor(
    private readonly row: Readonly<IssueRow>,
    private readonly posts: readonly Readonly<IssuePostRow>[] = [],
  ) {}

  toJSON() {
    const r = this.row;
    return {
      number: r.number,
      title: r.title,
      intro: r.intro,
      publishedAt: r.published_at?.toISOString() ?? null,
      posts: this.posts.map((p) => ({
        slug: p.slug,
        title: p.title ?? '',
        excerpt: p.excerpt ?? '',
      })),
    };
  }
}

/** 방문자의 호 목록 (발행한 호, 새 번호부터) */
export class PublicIssueListView {
  constructor(private readonly rows: readonly Readonly<IssueRow>[]) {}

  toJSON() {
    return { issues: this.rows.map((r) => new PublicIssueView(r).toJSON()) };
  }
}
