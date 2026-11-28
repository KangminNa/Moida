import { type ArchiveRecord, BaseEntity } from '../../platform';
import { SessionTranscript } from '../session/session-transcript';
import type { SessionTranscriptNew } from '../vault.tables';

// 보관 파일 vault/transcripts/<세션 id>/<번호>.md의 세션 원문 하나 (docs/보관형식.md).
// 본문은 쌓인 원문 그대로다: 민감정보는 처음 쌓을 때 지웠으므로 다시 지우지 않는다 (지우면 바이트가 달라진다).
// 해시는 쌓을 때와 같은 객체(SessionTranscript)로 다시 만들고, 지운 표시 · 올린 기기는 파일에 없어 돌아오지 않는다.
// 원문 표에는 meta가 없어 모르는 앞부분 키를 보관할 곳이 없다: 조용히 버리지 않고 멈춘다.
export class RestoredTranscript extends BaseEntity {
  private static readonly KNOWN: ReadonlySet<string> = new Set([
    'moida_format',
    'moida_type',
    'moida_id',
    'moida_session',
    'seq',
    'created',
  ]);
  /** 복원한 원문을 쌓은 쪽 (actor_type) */
  private static readonly SYSTEM = 'system';

  private constructor(
    private readonly fields: SessionTranscriptNew,
    /** 어느 파일에서 왔는지 (맞춰 볼 때 알려 준다) */
    readonly path: string,
  ) {
    super(fields.id, 1);
  }

  static read(record: ArchiveRecord): RestoredTranscript {
    const unknown = Object.keys(record.unknownKeys(RestoredTranscript.KNOWN));
    if (unknown.length > 0)
      throw record.problem(`원문 파일에는 모르는 앞부분 키를 둘 수 없어요: ${unknown.join(', ')}`);
    const seq = record.number('seq');
    if (!Number.isInteger(seq) || seq < 1) throw record.problem(`seq는 1 이상의 정수예요: ${seq}`);
    const created = record.date('created');
    if (created === null) throw record.problem('created이(가) 없어요');
    const text = record.body;
    if (text === '' || RestoredTranscript.charCount(text) > SessionTranscript.MAX)
      throw record.problem(`원문은 1~${SessionTranscript.MAX.toLocaleString('en-US')}자예요`);
    return new RestoredTranscript(
      {
        id: record.id(),
        session_id: record.id('moida_session'),
        seq,
        text,
        content_hash: SessionTranscript.restore(text).hash,
        redactions: null,
        actor_type: RestoredTranscript.SYSTEM,
        actor_id: null,
        created_at: created,
      },
      record.path,
    );
  }

  /** 글자 수: DB의 char_length처럼 코드 포인트로 센다 */
  private static charCount(text: string): number {
    let count = 0;
    for (const _ of text) count++;
    return count;
  }

  get sessionId(): string {
    return this.fields.session_id;
  }

  get seq(): number {
    return this.fields.seq;
  }

  get hash(): string {
    return this.fields.content_hash;
  }

  get createdAt(): Date {
    return this.fields.created_at ?? new Date(0);
  }

  /** 넣을 원문 행 */
  row(): SessionTranscriptNew {
    return this.fields;
  }
}
