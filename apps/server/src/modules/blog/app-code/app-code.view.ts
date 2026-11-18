import type { AppCodeVersionRow, AppRow } from '../blog.tables';

// 앱 코드의 읽기 모양 (스토어 1-6). 웹이 `import type`으로 가져온다. 관리자 화면(코드 탭 · 미리 보기)과 MCP app_code_base.

/** 파일 한 줄 (이름 · 형식 · 크기) */
interface CodeFileLine {
  readonly name: string;
  readonly mime: string;
  readonly sizeBytes: number;
}

/** 코드의 지금 상태 (쓰기 결과): 보이는 버전 · 확인 대기 버전 · 쌓인 버전 수 · 앱 버전 */
export class AppCodeStateView {
  constructor(private readonly row: Readonly<AppRow>) {}

  toJSON() {
    const r = this.row;
    return {
      appId: r.id,
      version: r.version,
      /** 방문자에게 보이는 버전. null이면 종류의 시작 코드 */
      current: r.code_seq,
      /** 확인 대기 버전 (공개 앱의 새 버전). 없으면 null */
      pending: r.code_pending_seq,
      latest: r.code_versions,
    };
  }
}

/** 버전 한 줄: 언제 · 어디서 왔나(시작 코드 · zip 올림 · AI 작업 · 복원) · 파일 수 · 크기 */
export class AppCodeVersionView {
  constructor(
    private readonly row: Readonly<AppCodeVersionRow>,
    private readonly files: readonly CodeFileLine[],
  ) {}

  toJSON() {
    const r = this.row;
    return {
      seq: r.seq,
      source: r.source,
      note: r.note,
      taskId: r.task_id,
      createdAt: r.created_at.toISOString(),
      fileCount: this.files.length,
      bytes: this.files.reduce((sum, f) => sum + f.sizeBytes, 0),
    };
  }
}

/** 코드 탭: 지금 상태 · 버전 목록(새 버전부터) · 보이는 코드의 파일 · 바깥 주소 */
export class AppCodeView {
  constructor(
    private readonly row: Readonly<AppRow>,
    private readonly versions: readonly AppCodeVersionView[],
    private readonly files: readonly CodeFileLine[],
    private readonly hosts: readonly string[],
  ) {}

  toJSON() {
    return {
      ...new AppCodeStateView(this.row).toJSON(),
      kind: this.row.kind,
      versions: this.versions.map((v) => v.toJSON()),
      files: this.files.map((f) => ({ name: f.name, mime: f.mime, sizeBytes: f.sizeBytes })),
      hosts: [...this.hosts],
    };
  }
}

/** 버전 하나의 바뀐 점: 앞 버전(없으면 시작 코드)과 파일 이름 · 내용 해시, 바깥 주소를 비교 */
export class AppCodeChangesView {
  constructor(
    private readonly seq: number,
    private readonly files: {
      readonly added: readonly string[];
      readonly changed: readonly string[];
      readonly removed: readonly string[];
    },
    private readonly hosts: {
      readonly before: readonly string[];
      readonly after: readonly string[];
    },
    private readonly bytes: number,
  ) {}

  toJSON() {
    const { before, after } = this.hosts;
    return {
      seq: this.seq,
      /** 비교한 앞 버전. 0이면 시작 코드 */
      base: this.seq - 1,
      added: [...this.files.added],
      changed: [...this.files.changed],
      removed: [...this.files.removed],
      hostsAdded: after.filter((h) => !before.includes(h)),
      hostsRemoved: before.filter((h) => !after.includes(h)),
      bytes: this.bytes,
    };
  }
}

/** 미리 보기 주소 (토큰이 든 /<앱>/~<토큰>/, 30분) */
export class AppCodePreviewView {
  constructor(private readonly url: string) {}

  toJSON() {
    return { url: this.url };
  }
}

/** app_code_base의 파일 하나: 글 파일이면 내용, 그림 등은 이름 · 크기만 */
export interface AppCodeBaseFile {
  readonly name: string;
  readonly size: number;
  readonly text: string | null;
}

/**
 * MCP app_code_base의 답 (snake_case): 쥔 만들기 일이 고칠 앱과 지금 코드(가장 새 버전, 없으면 시작 코드).
 * 고칠 앱이 없는 일이면 app_id null
 */
export class AppCodeBaseView {
  constructor(
    private readonly row: Readonly<AppRow> | null,
    private readonly seq: number,
    private readonly files: readonly AppCodeBaseFile[],
    private readonly hosts: readonly string[],
  ) {}

  toJSON() {
    const r = this.row;
    return {
      app_id: r?.id ?? null,
      name: r?.name ?? null,
      kind: r?.kind ?? null,
      slug: r?.slug ?? null,
      /** 받은 코드의 버전. 0이면 종류의 시작 코드 */
      seq: this.seq,
      files: this.files,
      hosts: [...this.hosts],
    };
  }
}
