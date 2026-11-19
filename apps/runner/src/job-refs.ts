import { join } from 'node:path';
import type { Json } from './json';
import type { PromptPack, PromptValues } from './prompt-pack';

/**
 * 이 일에서 받은 대화의 사진 (대화에 사진 넣기 ②-b, JobPhotos가 받는다). 사진 하나의 지시문 자리를 정한다:
 * 받았으면 파일 경로(AI가 읽는다) 또는 붙인 순서(지시에 붙인다), 받지 못했으면 받지 못한 사진
 */
export class RefPhotos {
  constructor(
    /** true: 지시에 붙인다 (codex exec --image), false: 받은 파일을 AI가 읽는다 (Claude Read) */
    private readonly attach: boolean,
    private readonly workDir: string,
    /** 받은 사진: 결과물 id → 작업 폴더 안의 경로 (받은 순서 = 붙이는 순서) */
    private readonly files: ReadonlyMap<string, string>,
  ) {}

  /** 지시문 틀 ref의 사진 자리 */
  fields(id: string): PromptValues {
    const file = this.files.get(id);
    if (file === undefined) return { photoMissed: true };
    if (!this.attach) return { photoPath: join(this.workDir, file) };
    return { photoNumber: [...this.files.keys()].indexOf(id) + 1 };
  }

  /** 지시에 붙일 파일 (작업 폴더 안의 경로: 쉼표 없는 이름이라 --image 값으로 나뉘지 않는다) */
  get attached(): readonly string[] {
    return this.attach ? [...this.files.values()] : [];
  }
}

/** 참조 한 줄 (서버가 확인해 payload.refs에 적은 것) */
class JobRef {
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  constructor(
    readonly kind: string,
    readonly id: string | null,
    readonly title: string,
    readonly hidden: boolean,
    readonly url: string | null,
    readonly browser: boolean,
    /** 서버가 사진(앞부분으로 알아본 PNG · JPEG · GIF · WebP)으로 본 결과물 */
    readonly image: boolean,
  ) {}

  static from(raw: Json): JobRef | null {
    const id = raw.optionalText('id');
    const url = raw.optionalText('url');
    if (id !== null && !JobRef.UUID.test(id)) return null;
    if (url !== null && !/^https?:\/\//i.test(url)) return null;
    if (id === null && url === null) return null;
    const kind = raw.text('kind');
    return new JobRef(
      kind,
      id,
      raw.text('title').slice(0, 200),
      raw.flag('private'),
      url,
      raw.flag('browser'),
      kind === 'output' && id !== null && raw.flag('image'),
    );
  }

  /**
   * 지시문의 한 줄 (틀 ref). 어떤 도구로 읽는지는 종류로 고른다. filesHere: 결과물을 inputs/에 받아 둔 일(만들기).
   * photos: 사진을 받은 일이면 그 사진 자리 (칸의 일 · 사진이 없는 일은 null: 결과물 줄 그대로)
   */
  line(prompts: PromptPack, filesHere: boolean, photos: RefPhotos | null): string {
    const kind = this.kind;
    const photo = this.image && !filesHere && photos !== null ? photos.fields(this.id ?? '') : null;
    return prompts.fill('ref', {
      title: this.title || (this.url ?? this.id ?? ''),
      private: this.hidden,
      id: this.id ?? '',
      url: this.url ?? '',
      wiki: kind === 'wiki',
      session: kind === 'session',
      post: kind === 'post',
      file: kind === 'output' && filesHere,
      handoff: kind === 'output' && !filesHere && photo === null,
      read: this.url !== null && !this.browser,
      browser: this.url !== null && this.browser,
      ...photo,
    });
  }
}

// 관리자가 대화에 넣은 참조 (2026-11-15 B, payload.refs): 위키 · 세션 · 글 · 결과물 · 스크랩 · 페이지 · 주소.
// 서버가 이 일의 작업 토큰에 읽기 허락으로 봉인했으니 AI는 도구(get_wiki · get_session · blog_get_post · read_url)로 읽는다.
// 결과물 파일은 칸의 만들기 일에서만 inputs/로 받아 둔다 (MakeStage). 그 밖의 일에서는 이름만 보인다
// (비공개 참조는 위임으로 셸 있는 담당에게 넘기지 못한다: 서버의 TaskRefs.handOn).
// 사진(image)은 칸 밖의 일이 work/photos/에 받아 AI CLI가 직접 본다 (JobPhotos, 대화에 사진 넣기 ②-b).
// 모양이 틀린 줄은 버린다 (서버의 값이지만 지시문에 그대로 싣기 전에 한 번 더 거른다)
export class JobRefs {
  private static readonly MAX = 10;
  /** 한 번에 받는 사진 (서버의 TaskRefs.PHOTOS_MAX와 같다) */
  private static readonly PHOTOS_MAX = 4;
  static readonly NONE = new JobRefs([]);

  private constructor(
    private readonly refs: readonly JobRef[],
    private readonly received: RefPhotos | null = null,
  ) {}

  static from(payload: Json): JobRefs {
    const refs = payload
      .list('refs')
      .map((r) => JobRef.from(r))
      .filter((r): r is JobRef => r !== null);
    return refs.length === 0 ? JobRefs.NONE : new JobRefs(refs.slice(0, JobRefs.MAX));
  }

  get empty(): boolean {
    return this.refs.length === 0;
  }

  /** 받아 둘 결과물 (id) */
  get outputs(): string[] {
    return this.refs.flatMap((r) => (r.kind === 'output' && r.id ? [r.id] : []));
  }

  /** 사진인 결과물: id → 이름 (넣은 순서, 4장까지) */
  get photos(): ReadonlyMap<string, string> {
    const photos = this.refs.flatMap((r) => (r.image && r.id ? [[r.id, r.title] as const] : []));
    return new Map(photos.slice(0, JobRefs.PHOTOS_MAX));
  }

  /** 받은 사진을 실은 같은 참조 (JobPhotos) */
  withPhotos(received: RefPhotos): JobRefs {
    return new JobRefs(this.refs, received);
  }

  /** 지시에 붙일 사진 파일 (작업 폴더 안의 경로, codex exec --image). 없으면 빈 목록 */
  get attachedPhotos(): readonly string[] {
    return this.received?.attached ?? [];
  }

  /** 지시문 단락 (틀 refs). filesHere: 결과물을 inputs/에 받아 둔 일 (만들기: MakeStage가 재료와 함께 받는다) */
  brief(prompts: PromptPack, filesHere: boolean): string {
    const lines = this.refs.map((r) => r.line(prompts, filesHere, this.received));
    return prompts.fill('refs', { lines: lines.join('\n') });
  }
}
