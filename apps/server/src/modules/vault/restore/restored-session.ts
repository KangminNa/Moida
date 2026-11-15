import { ArchiveFile, type ArchiveRecord, BaseEntity } from '../../platform';
import { Session } from '../session/session';
import { SessionNote } from '../session/session-note';
import {
  type NodeNew,
  SESSION_VISIBILITY,
  type SessionNew,
  type SessionRevisionActorType,
  type SessionRevisionKind,
  type SessionRevisionNew,
} from '../vault.tables';
import type { RestoredTranscript } from './restored-transcript';

// 보관 파일에서 읽은 세션 (restored-items.ts의 다른 항목들과 같은 길). 지금 판이 첫 판이 되고(판 번호 1), 판을 만든 쪽은 system이다.
// 칸 · 해시 · 찾기용 글은 저장할 때와 같은 객체(SessionNote)로 다시 만든다. 판 id는 파일에 없어 새로 짓는다.

/** vault/sessions/…/<날짜>-<주소>.md 하나. `cairn_note: false`면 노트(판)가 아직 없는 세션이라 판 없이 되살린다 */
export class RestoredSession extends BaseEntity {
  /**
   * 기기는 복원하지 않고 내보낸 파일에도 기기 id가 없다. device_id는 값이라(외래키 없음) 이 고정 값을 넣는다.
   * 대화 id(source_session_id)도 파일에 없어 세션 id로 채운다. 세 값 모두 진짜 기기의 값과 겹칠 수 없으므로
   * 복원 뒤 기기가 저장하는 세션은 UNIQUE (공간, 기기, 도구, 대화)에 걸리지 않고 새 세션이 된다.
   * 복원 전의 대화를 다시 저장해도 그 세션의 새 판이 아니라 새 세션이 된다.
   */
  static readonly NO_DEVICE = '00000000-0000-7000-8000-000000000000';
  private static readonly KNOWN: ReadonlySet<string> = new Set([
    'cairn_format',
    'cairn_type',
    'cairn_id',
    'title',
    'visibility',
    'tool',
    'started',
    'cairn_wiki',
    'cairn_pinned',
    'project',
    'tags',
    'cairn_note',
    'cairn_noted_seq',
  ]);
  /** 복원한 판을 만든 쪽 (actor_type) */
  private static readonly SYSTEM: SessionRevisionActorType = 'system';
  /** 복원한 판 (session_revisions.kind) */
  private static readonly ORIGIN: SessionRevisionKind = 'origin';

  private constructor(
    private readonly fields: Omit<SessionNew, 'space_id'>,
    /** 첫 판. 노트가 없는 세션은 null */
    readonly revision: SessionRevisionNew | null,
    /** 파일이 가리키는 대표 wiki. 그 wiki가 복원되지 않으면 도착 구역으로 간다 */
    readonly wikiId: string | null,
    /** 점(vault.nodes)이 만들어진 때: 시작한 때, 없으면 지금 */
    private readonly at: Date,
  ) {
    super(fields.node_id, 1);
  }

  static read(record: ArchiveRecord): RestoredSession {
    const wikiId = record.optionalId('cairn_wiki');
    const fields = {
      node_id: record.id(),
      visibility: record.oneOf('visibility', SESSION_VISIBILITY),
      tool: record.text('tool'),
      project: record.optionalText('project'),
      started_at: record.date('started'),
      pinned_sections: record.has('cairn_pinned')
        ? record.texts('cairn_pinned')
        : wikiId === null
          ? []
          : [Session.WIKI_KEY],
      noted_seq: RestoredSession.notedSeq(record),
    };
    const meta = ArchiveFile.metaOf(record.unknownKeys(RestoredSession.KNOWN));
    const at = fields.started_at ?? new Date();
    const base = {
      ...fields,
      device_id: RestoredSession.NO_DEVICE,
      source_session_id: fields.node_id,
      last_revision_at: at,
      meta,
    };
    if (!record.flag('cairn_note', true)) {
      // 본문을 조용히 버리지 않는다: 사람이 노트를 써 넣었다면 cairn_note를 지워야 판이 된다
      if (record.body !== '' || record.texts('tags').length > 0)
        throw record.problem('노트 없는 세션(cairn_note: false)인데 본문 · 태그가 있어요');
      const title = record.optionalText('title');
      return new RestoredSession(
        { ...base, head_revision_id: null, head_title: title, head_text: null, revision_count: 0 },
        null,
        wikiId,
        at,
      );
    }
    const note = record.attempt(() =>
      SessionNote.write(
        record.text('title'),
        record.texts('tags'),
        RestoredSession.sections(record.body),
      ),
    );
    const revision = {
      id: BaseEntity.newId(),
      seq: 1,
      actor_type: RestoredSession.SYSTEM,
      created_at: at,
    };
    return new RestoredSession(
      {
        ...base,
        head_revision_id: revision.id,
        head_title: note.title,
        head_text: record.body,
        revision_count: 1,
      },
      // 본문 md는 파일 그대로. 칸은 노트에서 다시 만들지만 내보낼 글은 바이트까지 지킨다
      {
        ...revision,
        session_id: fields.node_id,
        kind: RestoredSession.ORIGIN,
        ...note.revision(),
        body_md: record.body,
      },
      wikiId,
      at,
    );
  }

  /** 지금 노트를 쓴 원문의 번호 (없으면 0) */
  private static notedSeq(record: ArchiveRecord): number {
    const seq = record.optionalNumber('cairn_noted_seq') ?? 0;
    if (!Number.isInteger(seq) || seq < 0)
      throw record.problem(`cairn_noted_seq는 0 이상의 정수예요: ${seq}`);
    return seq;
  }

  /** 지금 노트를 쓴 원문의 번호. 그 원문이 함께 들어오는지 맞춰 본다 */
  get notedSeq(): number {
    return this.fields.noted_seq ?? 0;
  }

  /**
   * SessionNote.toMarkdown의 반대: 고정 소제목으로 칸을 나눈다. 소제목은 정해진 순서로, 위아래가 빈 줄일 때만 칸의 시작이다.
   * 칸의 글 안에 똑같은 줄이 있으면 경계가 어긋날 수 있지만, 본문은 그대로 남아 내용은 사라지지 않는다.
   */
  private static sections(body: string): ReadonlyMap<string, string> {
    const lines = body.split('\n');
    const found = new Map<string, string[]>();
    let current: string[] | null = null;
    let next = 0;
    lines.forEach((line, i) => {
      const at = SessionNote.SECTIONS.findIndex(
        ([, heading], order) => order >= next && line === `## ${heading}`,
      );
      const alone = at >= 0 && (lines[i - 1] ?? '') === '' && (lines[i + 1] ?? '') === '';
      if (!alone) {
        current?.push(line);
        return;
      }
      current = [];
      found.set(SessionNote.SECTIONS[at]?.[0] ?? '', current);
      next = at + 1;
    });
    return new Map([...found].map(([name, text]) => [name, text.join('\n')]));
  }

  /** 이 공간에 넣을 점 */
  nodeIn(spaceId: string): NodeNew {
    return { id: this.id, space_id: spaceId, kind: 'session', created_at: this.at };
  }

  /**
   * 이 공간에 넣을 세션 행. wikiId: 대표 wiki 중 복원되는 것 (파일의 값과 다를 수 있다).
   * transcripts: 이 세션의 원문 (번호가 1부터 이어진다). 원문 수와 마지막으로 들어온 때가 여기서 정해진다
   */
  rowIn(
    spaceId: string,
    wikiId: string | null,
    transcripts: readonly RestoredTranscript[],
  ): SessionNew {
    const last = transcripts.reduce((at, t) => (t.createdAt > at ? t.createdAt : at), this.at);
    return {
      ...this.fields,
      space_id: spaceId,
      wiki_id: wikiId,
      transcript_count: transcripts.length,
      last_revision_at: last,
    };
  }
}
