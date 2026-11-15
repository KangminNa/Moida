import type { Json } from './json';
import type { PromptPack } from './prompt-pack';

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
  ) {}

  static from(raw: Json): JobRef | null {
    const id = raw.optionalText('id');
    const url = raw.optionalText('url');
    if (id !== null && !JobRef.UUID.test(id)) return null;
    if (url !== null && !/^https?:\/\//i.test(url)) return null;
    if (id === null && url === null) return null;
    return new JobRef(
      raw.text('kind'),
      id,
      raw.text('title').slice(0, 200),
      raw.flag('private'),
      url,
      raw.flag('browser'),
    );
  }

  /** 지시문의 한 줄 (틀 ref). 어떤 도구로 읽는지는 종류로 고른다. filesHere: 결과물을 inputs/에 받아 둔 일(만들기) */
  line(prompts: PromptPack, filesHere: boolean): string {
    const kind = this.kind;
    return prompts.fill('ref', {
      title: this.title || (this.url ?? this.id ?? ''),
      private: this.hidden,
      id: this.id ?? '',
      url: this.url ?? '',
      wiki: kind === 'wiki',
      session: kind === 'session',
      post: kind === 'post',
      file: kind === 'output' && filesHere,
      handoff: kind === 'output' && !filesHere,
      read: this.url !== null && !this.browser,
      browser: this.url !== null && this.browser,
    });
  }
}

// 관리자가 대화에 넣은 참조 (2026-11-15 B, payload.refs): 위키 · 세션 · 글 · 결과물 · 스크랩 · 페이지 · 주소.
// 서버가 이 일의 작업 토큰에 읽기 허락으로 봉인했으니 AI는 도구(get_wiki · get_session · blog_get_post · read_url)로 읽는다.
// 결과물 파일은 칸의 만들기 일에서만 inputs/로 받아 둔다 (MakeStage). 그 밖의 일에서는 이름만 보인다
// (비공개 참조는 위임으로 셸 있는 담당에게 넘기지 못한다: 서버의 TaskRefs.handOn).
// 모양이 틀린 줄은 버린다 (서버의 값이지만 지시문에 그대로 싣기 전에 한 번 더 거른다)
export class JobRefs {
  private static readonly MAX = 10;
  static readonly NONE = new JobRefs([]);

  private constructor(private readonly refs: readonly JobRef[]) {}

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

  /** 지시문 단락 (틀 refs). filesHere: 결과물을 inputs/에 받아 둔 일 (만들기: MakeStage가 재료와 함께 받는다) */
  brief(prompts: PromptPack, filesHere: boolean): string {
    const lines = this.refs.map((r) => r.line(prompts, filesHere));
    return prompts.fill('refs', { lines: lines.join('\n') });
  }
}
