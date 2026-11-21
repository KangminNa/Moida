import { RuleViolation } from '../../platform';

/**
 * 참조 한 줄 (회차 · 하위 작업의 payload.refs). 보관함의 것은 kind · id · title · private, 주소는 kind url · url · browser.
 * image: 사진인 결과물 (대화에 사진 넣기, 2026-11-19): 러너가 작업 폴더로 받아 AI CLI가 직접 본다.
 * 서버가 확인해 적은 값이라 러너는 그대로 지시문에 싣는다 (읽는 도구는 종류로 고른다)
 */
export type TaskRef = {
  kind: string;
  id: string | null;
  title: string;
  private: boolean;
  url: string | null;
  browser: boolean;
  image: boolean;
};

/** 관리자가 고른 참조 하나 (입력의 모양만 검사한 것) */
export type RefPick = { kind: string; id: string | null; url: string | null; browser: boolean };

/** 보관함이 알려 준 줄 (LibraryQuery.describe): 무엇인지, 공개 범위, 바깥 주소(읽은 글 · 공개 페이지) */
export type RefFound = {
  kind: string;
  id: string;
  title: string;
  visibility: string;
  url: string | null;
};

// 대화에 넣은 참조 (2026-11-15 B, 기획서 결정): 위키 · 세션 · 글 · 페이지 · 결과물 · 스크랩, 그리고 주소.
// 회차마다 고른 것만 그 작업의 토큰에 읽기 허락(Actor.mayRead)으로 봉인한다 (만들기 재료와 같은 길). 내용을 지시문에 복사하지 않는다.
// 비공개 참조도 어느 일꾼에게나 넘긴다 (2026-11-21, 사용자 결정 "비공개도 그냥 읽어": 모두 같은 일꾼).
// 위임은 위 작업의 참조 가운데서만 고른다 (AI가 허락을 만들 수 없다)
export class TaskRefs {
  static readonly MAX = 10;
  /** 한 메시지의 사진 (참조 MAX 안에서). 사진은 AI의 토큰을 많이 쓴다 */
  static readonly PHOTOS_MAX = 4;
  /** 보관함의 종류 (LibraryQuery에 등록된 종류) */
  static readonly KINDS: readonly string[] = ['wiki', 'session', 'post', 'page', 'output', 'link'];
  static readonly URL = 'url';
  /** 공개로 보는 값 (보관함 줄의 visibility: 위키 · 세션 · 페이지는 public, 글은 published) */
  private static readonly PUBLIC: readonly string[] = ['public', 'published'];

  private constructor(readonly lines: readonly TaskRef[]) {}

  /** 작업의 payload에서 (서버가 적은 값). 없으면 빈 참조 */
  static of(payload: unknown): TaskRefs {
    const refs = (payload as { refs?: unknown } | null)?.refs;
    return new TaskRefs(Array.isArray(refs) ? (refs as TaskRef[]) : []);
  }

  /**
   * 고른 참조를 보관함의 줄로 확인한다. 없거나 휴지통에 있는 것이 있으면 RuleViolation.
   * images: 사진인 결과물의 id (OutputQuery.imageIds). 사진은 PHOTOS_MAX장까지
   */
  static resolve(
    picks: readonly RefPick[],
    found: readonly RefFound[],
    images: ReadonlySet<string> = new Set(),
  ): TaskRefs {
    if (picks.length > TaskRefs.MAX) throw new RuleViolation(`참조는 ${TaskRefs.MAX}개까지예요`);
    const lines = picks.map((p): TaskRef => {
      if (p.kind === TaskRefs.URL)
        return {
          kind: p.kind,
          id: null,
          title: p.url ?? '',
          private: false,
          url: p.url,
          browser: p.browser,
          image: false,
        };
      const row = found.find((f) => f.id === p.id && f.kind === p.kind);
      if (!row) throw new RuleViolation('없거나 휴지통에 있는 참조예요');
      const hidden = !TaskRefs.PUBLIC.includes(row.visibility);
      // 페이지는 AI가 id로 읽는 도구가 없어 공개한 페이지의 주소로만 넘긴다 (read_url)
      if (row.kind === 'page' && hidden)
        throw new RuleViolation(
          `비공개 페이지는 참조로 넣지 못해요 (공개한 페이지만): ${row.title}`,
        );
      const outside = row.kind === 'page' || row.kind === 'link' ? row.url : null;
      return {
        kind: row.kind,
        id: row.id,
        title: row.title,
        private: hidden,
        url: outside,
        browser: false,
        image: row.kind === 'output' && images.has(row.id),
      };
    });
    const unique = lines.filter(
      (l, i) => lines.findIndex((o) => TaskRefs.key(o) === TaskRefs.key(l)) === i,
    );
    if (unique.filter((l) => l.image).length > TaskRefs.PHOTOS_MAX)
      throw new RuleViolation(`사진은 한 번에 ${TaskRefs.PHOTOS_MAX}장까지예요`);
    return new TaskRefs(unique);
  }

  /** 보관함에서 확인할 id (주소가 아닌 것) */
  static idsOf(picks: readonly RefPick[]): string[] {
    return picks.flatMap((p) => (p.kind === TaskRefs.URL || !p.id ? [] : [p.id]));
  }

  /** 사진인지 물을 결과물의 id */
  static outputIdsOf(picks: readonly RefPick[]): string[] {
    return picks.flatMap((p) => (p.kind === 'output' && p.id ? [p.id] : []));
  }

  get empty(): boolean {
    return this.lines.length === 0;
  }

  /** 작업 토큰에 봉인할 읽기 허락 (주소가 아닌 것의 id) */
  get readIds(): string[] {
    return this.lines.flatMap((l) => (l.id ? [l.id] : []));
  }

  /** 러너가 받아 inputs/에 둘 결과물 (begin_download가 허락한다) */
  get outputs(): string[] {
    return this.lines.flatMap((l) => (l.kind === 'output' && l.id ? [l.id] : []));
  }

  /**
   * 위임: 위 작업의 참조 가운데 고른 것 (id나 주소). 위 작업에 없는 것은 RuleViolation. 고르지 않으면 넘기지 않는다
   */
  handOn(chosen: readonly string[] | null): TaskRefs {
    if (!chosen || chosen.length === 0) return new TaskRefs([]);
    const picked = chosen.map((c) => {
      const line = this.lines.find((l) => l.id === c || l.url === c);
      if (!line) throw new RuleViolation(`이 작업에 없는 참조예요: ${c}`);
      return line;
    });
    return new TaskRefs([...new Set(picked)]);
  }

  /** 작업의 payload에 펼칠 칸 (없으면 빈 객체) */
  get payload(): Record<string, unknown> {
    return this.empty ? {} : { refs: this.lines };
  }

  private static key(line: TaskRef): string {
    return `${line.kind}:${line.id ?? line.url}`;
  }
}
