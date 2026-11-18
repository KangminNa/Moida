import type { PageRevisionRow, PageRow } from '../blog.tables';

/** 페이지 하나 (콘솔의 페이지 메뉴, 주인) */
export class PageView {
  constructor(
    private readonly row: PageRow,
    /** 마지막 판을 만든 작업. 목록에서만 채운다 (화면이 방금 맡긴 작업의 페이지를 찾는다) */
    private readonly lastTaskId: string | null = null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      title: r.title,
      visibility: r.visibility,
      currentSeq: r.current_seq,
      /** 확인을 기다리는 판 (공개 페이지의 새 판). 없으면 null */
      pendingSeq: r.pending_seq,
      direction: r.direction,
      /** 든 앱 · 올린 메뉴 (스토어 1단계 · 2차 6단계). 없으면 null */
      appId: r.app_id,
      menuId: r.menu_id,
      revisions: r.revisions,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      lastTaskId: this.lastTaskId,
    };
  }
}

export class PageListView {
  constructor(private readonly pages: readonly PageView[]) {}

  toJSON() {
    return { pages: this.pages.map((p) => p.toJSON()) };
  }
}

/** 방문자가 보는 공개 페이지 한 줄: 이름과 제목뿐 (판 · 만든 작업은 내보내지 않는다) */
export class PublicPageView {
  constructor(private readonly row: Pick<PageRow, 'name' | 'title' | 'updated_at'>) {}

  toJSON() {
    return {
      name: this.row.name,
      title: this.row.title,
      updatedAt: this.row.updated_at.toISOString(),
    };
  }
}

export class PublicPageListView {
  constructor(private readonly pages: readonly PublicPageView[]) {}

  toJSON() {
    return { pages: this.pages.map((p) => p.toJSON()) };
  }
}

/** 판 한 줄: 언제 · 어떤 요청으로 · 어느 작업이 만들었나 */
export class PageRevisionView {
  constructor(
    private readonly row: PageRevisionRow,
    private readonly files: readonly { readonly name: string; readonly sizeBytes: number }[],
  ) {}

  toJSON() {
    const r = this.row;
    return {
      seq: r.seq,
      note: r.note,
      taskId: r.task_id,
      runId: r.run_id,
      files: this.files.map((f) => ({ name: f.name, sizeBytes: f.sizeBytes })),
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 페이지 하나와 판 목록 (새 판부터). pendingPath: 확인 대기 판을 미리 볼 주소 (그 판에 묶인 보기 표, 30분) */
export class PageDetailView {
  constructor(
    private readonly page: PageView,
    private readonly revisions: readonly PageRevisionView[],
    private readonly pendingPath: string | null = null,
  ) {}

  toJSON() {
    return {
      ...this.page.toJSON(),
      revisionList: this.revisions.map((r) => r.toJSON()),
      pendingPath: this.pendingPath,
    };
  }
}

/** data.json의 바뀐 점 한 줄: 경로, added · removed · changed, 앞 · 뒤 값(JSON 글자, 잘림) */
export interface PageDataChange {
  path: string;
  kind: string;
  before: string | null;
  after: string | null;
}

/**
 * 판 하나의 바뀐 점 (자라는 페이지, 2차 5단계): 앞 판과 비교한 data.json의 차이.
 * data가 false면 이 판에 data.json이 없거나 읽을 수 없다 (그때 changes는 비어 있다)
 */
export class PageChangesView {
  constructor(
    private readonly seq: number,
    private readonly data: boolean,
    private readonly changes: readonly PageDataChange[],
    private readonly truncated: boolean,
  ) {}

  toJSON() {
    return {
      seq: this.seq,
      base: this.seq > 1 ? this.seq - 1 : null,
      data: this.data,
      changes: this.changes,
      truncated: this.truncated,
    };
  }
}

/** page_base의 파일 하나: 글 파일이면 내용, 그림 등은 이름 · 크기만 (새 판에서 그대로 남는다) */
export interface PageBaseFile {
  name: string;
  size: number;
  text: string | null;
}

/**
 * page_base의 답 (러너에게, 2차 5단계): 고칠 페이지의 가장 새 판 · 방향. 고칠 페이지가 없는 일이면 page_id가 null
 */
export class PageBaseView {
  constructor(
    private readonly row: Pick<PageRow, 'id' | 'title' | 'direction'> | null,
    private readonly seq: number,
    private readonly files: readonly PageBaseFile[],
  ) {}

  toJSON() {
    const r = this.row;
    return {
      page_id: r?.id ?? null,
      title: r?.title ?? null,
      direction: r?.direction ?? '',
      seq: this.seq,
      files: this.files,
    };
  }
}
