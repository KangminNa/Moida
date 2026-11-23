import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseQuery,
  Database,
  Leases,
  LibraryInput,
  type LibraryRow,
  NotFound,
  Redaction,
  SensitivePolicy,
} from '../../platform';
import { sessionRevisions, sessionTranscripts } from '../vault.schema';
import type { RunMemoRow, SessionRevisionRow, SessionRow } from '../vault.tables';
import { AgentRunRecord } from './agent-run-record';
import type { RunMemosInput } from './run-record.input';
import { RunMemosView } from './run-record.view';
import { Session } from './session';
import {
  type CheckSessionInput,
  GetSessionInput,
  ListSessionsInput,
  type NoteWorkInput,
  type ReadSessionInput,
  SearchSessionsInput,
} from './session.input';
import {
  RedactionView,
  type RevisionStampRow,
  RevisionStampView,
  type SessionCheckRow,
  SessionCheckView,
  SessionDetailView,
  SessionHitPageView,
  type SessionHitRow,
  SessionHitView,
  SessionNoteView,
  SessionPageView,
  SessionRevisionView,
  SessionSectionView,
  SessionSummaryView,
  type TranscriptJobRow,
  TranscriptJobView,
  type TranscriptStampRow,
  TranscriptStampView,
  TranscriptView,
} from './session.view';
import { SessionNote } from './session-note';
import { SessionTranscript } from './session-transcript';
import { SessionTrashLineView, SessionTrashView } from './session-trash.view';

// 세션 읽기. 관리 화면의 목록·상세·판은 비공개까지 볼 수 있는 요청자(주인, read_all 기기)만,
// AI 도구의 찾기·읽기(search · note)는 read_public이나 read_all 중 하나로, read_public은 공개 세션만 본다.
// 방문자용 공개 세션 보기는 그래프(M2)에서 따로 만든다.
@Injectable()
export class SessionQuery extends BaseQuery {
  /** 보관함의 종류 (세션) */
  static readonly LIBRARY_KIND = 'session';
  private static readonly PAGE = 30;
  private static readonly TRASH_LIMIT = 200;
  /** 찾은 결과의 본문 조각: 전체 길이, 그중 찾은 말 앞에 남길 길이 */
  private static readonly EXCERPT = 160;
  private static readonly EXCERPT_LEAD = 40;

  constructor(
    db: Database,
    private readonly sensitive: SensitivePolicy,
    private readonly leases: Leases,
  ) {
    super(db);
  }

  /**
   * 저장 전 검사 (AI 도구의 check_session). 아무것도 쓰지 않는다.
   * 노트 모양(제목, 칸 하나 이상)을 보고, 서버가 지울 비밀값을 알려 주고, 이번 저장에 쓸 request_id와 대화 id를 준다.
   * 대화 id를 모르면 새로 만든다 ("conv-" + UUID). 같은 대화로 이미 저장한 세션이 있으면 그 판 수도 알려 준다.
   * site는 노트가 올라갈 블로그 주소다.
   */
  async check(actor: Actor, req: CheckSessionInput, site: string): Promise<SessionCheckView> {
    actor.assertCan(Actor.UPLOAD);
    const [spaceId, deviceId] = Session.uploader(actor);
    const note = SessionNote.write(req.title, req.tags, req.sections).scrubbedBy(this.sensitive);
    const [found] =
      req.sourceSessionId && req.tool
        ? await this.sql<SessionCheckRow[]>`
            SELECT s.node_id,
                   (SELECT count(*) FROM vault.session_revisions r WHERE r.session_id = s.node_id)::int AS revisions
            FROM vault.sessions s
            WHERE s.space_id = ${spaceId} AND s.device_id = ${deviceId}
              AND s.tool = ${req.tool} AND s.source_session_id = ${req.sourceSessionId}`
        : [];
    return new SessionCheckView(
      randomUUID(),
      req.sourceSessionId ?? `conv-${randomUUID()}`,
      found ?? null,
      SessionQuery.redactions(note),
      site,
      [SessionNote.SECTION_MAX, SessionNote.QUOTES_MAX],
    );
  }

  async list(actor: Actor, req: ListSessionsInput): Promise<SessionPageView> {
    actor.assertCan(Actor.READ_ALL);
    const rows = await this.sql<SessionRow[]>`
      SELECT s.* FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${actor.spaceId} AND n.deleted_at IS NULL ${this.visibleTo(actor, 's.visibility')}
        ${req.project === null ? this.sql`` : this.sql`AND s.project = ${req.project}`}
        ${req.before === null ? this.sql`` : this.sql`AND (s.last_revision_at, s.node_id) < (${req.before[0]}, ${req.before[1]})`}
      ORDER BY s.last_revision_at DESC, s.node_id DESC
      LIMIT ${SessionQuery.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, SessionQuery.PAGE, (last) =>
      last.last_revision_at
        ? ListSessionsInput.cursorAfter(last.last_revision_at, last.node_id)
        : null,
    );
    return new SessionPageView(
      items.map((r) => new SessionSummaryView(r)),
      next,
    );
  }

  /** 휴지통의 세션 (관리자만). 넣은 때가 늦은 순으로 TRASH_LIMIT개까지 */
  async trash(actor: Actor): Promise<SessionTrashView> {
    actor.assertOwner();
    const rows = await this.sql<
      (Pick<
        SessionRow,
        | 'node_id'
        | 'head_title'
        | 'project'
        | 'tool'
        | 'revision_count'
        | 'last_revision_at'
        | 'version'
      > & { deleted_at: Date })[]
    >`
      SELECT s.node_id, s.head_title, s.project, s.tool, s.revision_count, s.last_revision_at,
        s.version, n.deleted_at
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${actor.requireSpace()} AND n.deleted_at IS NOT NULL
      ORDER BY n.deleted_at DESC, s.node_id DESC LIMIT ${SessionQuery.TRASH_LIMIT}`;
    return new SessionTrashView(rows.map((r) => new SessionTrashLineView(r)));
  }

  /** 세션 하나: 지금 판(원문만 있고 노트가 아직 없으면 null), 판 기록, 원문 기록 (내용 없이) */
  async get(actor: Actor, req: ReadSessionInput): Promise<SessionDetailView> {
    actor.assertCan(Actor.READ_ALL);
    const session = await this.find(actor, req.id);
    const history = await this.sql<RevisionStampRow[]>`
      SELECT seq, kind, actor_type, created_at, coalesce(jsonb_array_length(redactions), 0) AS redactions
      FROM vault.session_revisions WHERE session_id = ${req.id} ORDER BY seq DESC`;
    const transcripts = await this.sql<TranscriptStampRow[]>`
      SELECT seq, char_length(text) AS chars, created_at,
             coalesce(jsonb_array_length(redactions), 0) AS redactions
      FROM vault.session_transcripts WHERE session_id = ${req.id} ORDER BY seq DESC`;
    return new SessionDetailView(
      session,
      session.head_revision_id === null ? null : SessionQuery.revision(await this.headOf(session)),
      history.map((r) => new RevisionStampView(r)),
      transcripts.map((t) => new TranscriptStampView(t)),
    );
  }

  /** 원문 하나 (관리 화면의 원문 보기). 지운 민감정보는 [지움: 종류]로 남아 있다 */
  async transcriptOf(actor: Actor, req: ReadSessionInput): Promise<TranscriptView> {
    // 이 작업에만 읽기를 허락받은 세션(대화의 참조, Actor.mayRead)은 비공개를 읽는 권한 없이도 (2026-11-15 B)
    if (!actor.mayRead(req.id)) actor.assertCan(Actor.READ_ALL);
    await this.find(actor, req.id);
    const row = await this.row(sessionTranscripts, { session_id: req.id, seq: req.seq ?? 0 });
    if (!row) throw new NotFound(`원문 ${req.seq}이 없어요`);
    return new TranscriptView(row);
  }

  /**
   * 서버 러너가 세션 노트를 쓸 원문 (MCP read_transcript): 이 러너가 지금 쥔 세션 노트 일의 세션 · 원문만
   * (platform Leases로 묻는다). AI에게 줄 만큼 가운데를 줄인 글
   */
  async transcriptFor(actor: Actor, req: NoteWorkInput): Promise<TranscriptJobView> {
    actor.assertCan(Actor.RUN);
    const [sessionId, seq] = Session.noteWork(await this.leases.of(actor, req.taskId));
    const [row] = await this.sql<TranscriptJobRow[]>`
      SELECT s.node_id, s.tool, s.project, s.head_title, s.started_at, t.seq, t.text
      FROM vault.sessions s JOIN vault.session_transcripts t ON t.session_id = s.node_id
      WHERE s.node_id = ${sessionId} AND s.space_id = ${actor.requireSpace()} AND t.seq = ${seq}`;
    if (!row) throw new NotFound('원문을 찾을 수 없어요');
    return new TranscriptJobView(row, SessionTranscript.restore(row.text).forPrompt());
  }

  /**
   * 같은 세션 키의 지난 인수인계 메모 (run_memos, 2026-11-17): 그 일을 쥔 러너만(platform Leases.forRecord).
   * 최근 것 몇 개를 오래된 것부터. 휴지통의 작업 세션에 쌓인 메모는 주지 않는다
   */
  async runMemos(actor: Actor, req: RunMemosInput): Promise<RunMemosView> {
    actor.assertCan(Actor.RUN);
    const target = await this.leases.forRecord(actor, req.taskId);
    const spaceId = actor.requireSpace();
    const [flow] = await this.sql<Pick<SessionRow, 'node_id'>[]>`
      SELECT node_id FROM vault.sessions
      WHERE space_id = ${spaceId} AND tool = ${Session.AGENT_TOOL} AND source_session_id = ${target.flow}`;
    const memos = await this.sql<RunMemoRow[]>`
      SELECT m.* FROM vault.run_memos m JOIN vault.nodes n ON n.id = m.session_id
      WHERE m.space_id = ${spaceId} AND m.lineage = ${target.lineage} AND n.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC LIMIT ${AgentRunRecord.LINEAGE_MEMOS}`;
    return new RunMemosView(flow?.node_id ?? null, memos.reverse());
  }

  /** 판 하나 (지난 판 보기) */
  async revisionOf(actor: Actor, req: ReadSessionInput): Promise<SessionRevisionView> {
    actor.assertCan(Actor.READ_ALL);
    await this.find(actor, req.id);
    const row = await this.row(sessionRevisions, { session_id: req.id, seq: req.seq ?? 0 });
    if (!row) throw new NotFound(`버전 ${req.seq}이 없어요`);
    return SessionQuery.revision(row);
  }

  /**
   * 키워드로 찾기 (AI 도구의 search_sessions). 제목과 지금 판의 본문에서 찾는다 (pg_bigm: 대소문자 구분).
   * 공개 범위를 SQL에서 먼저 거른 뒤 쪽을 나눠서, 비공개 세션은 결과·본문 조각·next 어디에도 영향을 주지 않는다.
   * 순서는 세션 id(UUIDv7) 내림차순: 저장해도 바뀌지 않는 값이라 쪽을 넘기는 사이에 새 판이 쌓여도
   * 세션이 빠지거나 두 번 나오지 않는다.
   */
  async search(actor: Actor, req: SearchSessionsInput): Promise<SessionHitPageView> {
    this.assertCanRead(actor);
    const [lead = ''] = req.words;
    const rows = await this.sql<SessionHitRow[]>`
      SELECT s.node_id, s.head_title, s.project, s.tool, s.last_revision_at,
             substr(s.head_text,
                    greatest(position(${lead} in s.head_text) - ${SessionQuery.EXCERPT_LEAD}, 1),
                    ${SessionQuery.EXCERPT}) AS excerpt
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${actor.spaceId} AND n.deleted_at IS NULL ${this.visibleTo(actor, 's.visibility')}
        ${req.words.map((word) => this.sql`AND (s.head_title LIKE likequery(${word}) OR s.head_text LIKE likequery(${word}))`)}
        ${req.project === null ? this.sql`` : this.sql`AND s.project = ${req.project}`}
        ${req.tool === null ? this.sql`` : this.sql`AND s.tool = ${req.tool}`}
        ${req.from === null ? this.sql`` : this.sql`AND s.last_revision_at >= ${req.from}`}
        ${req.to === null ? this.sql`` : this.sql`AND s.last_revision_at <= ${req.to}`}
        ${req.before === null ? this.sql`` : this.sql`AND s.node_id < ${req.before}`}
      ORDER BY s.node_id DESC
      LIMIT ${req.limit + 1}`;
    const { items, next } = this.pageOf(rows, req.limit, (last) =>
      SearchSessionsInput.cursorAfter(last.node_id),
    );
    return new SessionHitPageView(
      items.map((r) => new SessionHitView(r)),
      next,
    );
  }

  /** 세션 하나의 지금 판 (AI 도구의 get_session). 볼 수 없는 세션은 없는 세션과 똑같이 NotFound */
  async note(actor: Actor, req: GetSessionInput): Promise<SessionNoteView> {
    if (!actor.mayRead(req.id)) this.assertCanRead(actor);
    const session = await this.find(actor, req.id);
    return new SessionNoteView(session, SessionQuery.revision(await this.headOf(session)));
  }

  /**
   * ids 중 볼 수 있는 세션의 id → 노트 제목 (blog의 스크랩이 platform Lookups의 'session'으로 묻는다, 리팩토링 R3b).
   * note와 같은 규칙: 읽기 권한이 없으면 Forbidden, 없거나 볼 수 없거나 노트가 아직 없는 세션은 빠진다
   */
  async titles(actor: Actor, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const found = new Map<string, string>();
    for (const id of ids) {
      try {
        found.set(
          id,
          (await this.note(actor, GetSessionInput.from({ session_id: id }))).summary.title,
        );
      } catch (error) {
        if (!(error instanceof NotFound)) throw error;
      }
    }
    return found;
  }

  /** AI 도구의 읽기는 read_public이나 read_all 중 하나만 있어도 된다 */
  private assertCanRead(actor: Actor): void {
    if (!actor.canSeePrivate()) actor.assertCan(Actor.READ_PUBLIC);
  }

  private async headOf(session: SessionRow): Promise<SessionRevisionRow> {
    const id = session.head_revision_id;
    const head = id === null ? null : await this.row(sessionRevisions, { id });
    if (!head) throw new NotFound('세션의 지금 버전을 찾을 수 없어요');
    return head;
  }

  /** 볼 수 있는 세션 행 하나 (휴지통·다른 공간·비공개 제외) */
  private async find(actor: Actor, id: string): Promise<SessionRow> {
    const [row] = await this.sql<SessionRow[]>`
      SELECT s.* FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.node_id = ${id} AND s.space_id = ${actor.spaceId} AND n.deleted_at IS NULL
        ${actor.mayRead(id) ? this.sql`` : this.visibleTo(actor, 's.visibility')}`;
    if (!row) throw new NotFound('세션을 찾을 수 없어요');
    return row;
  }

  /** 판 하나: 노트(sections 칸)에서 제목 · 태그 · 칸과 지운 자리를 읽는다 */
  private static revision(row: SessionRevisionRow): SessionRevisionView {
    const note = SessionNote.restore(row);
    return new SessionRevisionView(
      row,
      note.title,
      note.tags,
      SessionNote.SECTIONS.map(
        ([name, heading]) => new SessionSectionView(name, heading, note.section(name)),
      ),
      SessionQuery.redactions(note),
    );
  }

  private static redactions(note: SessionNote): readonly RedactionView[] {
    return note.redactions.map((r) => new RedactionView(Redaction.SECRET, r.section, r.label));
  }

  /** 보관함의 세션 (2차 5단계, platform LibraryQuery에 등록). 프로젝트로 거를 수 있는 종류는 세션뿐이다 */
  /** 보관함의 일괄 지우기 (2026-11-23): 휴지통이 아닌 세션의 지금 판 (주인만) */
  async liveVersions(
    actor: Actor,
    ids: readonly string[],
  ): Promise<{ id: string; version: number }[]> {
    actor.assertOwner();
    return this.sql<{ id: string; version: number }[]>`
      SELECT s.node_id AS id, s.version FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${actor.requireSpace()} AND s.node_id = ANY(${[...ids]}::uuid[])
        AND n.deleted_at IS NULL
      ORDER BY s.node_id`;
  }

  async library(actor: Actor, filter: LibraryInput): Promise<readonly LibraryRow[]> {
    actor.assertOwner();
    const rows = await this.sql<
      Pick<SessionRow, 'node_id' | 'head_title' | 'project' | 'visibility' | 'last_revision_at'>[]
    >`
      SELECT s.node_id, s.head_title, s.project, s.visibility, s.last_revision_at
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${actor.requireSpace()} AND n.deleted_at IS NULL
        AND s.last_revision_at IS NOT NULL
        ${filter.project === null ? this.sql`` : this.sql`AND s.project = ${filter.project}`}
        ${this.libraryWindow('s.last_revision_at', 's.node_id', 's.head_title', filter)}
      ORDER BY s.last_revision_at DESC, s.node_id DESC LIMIT ${LibraryInput.PAGE + 1}`;
    return rows.map((r) => ({
      kind: SessionQuery.LIBRARY_KIND,
      id: r.node_id,
      title: r.head_title || '제목 없음',
      project: r.project,
      at: r.last_revision_at as Date,
      href: `/admin/sessions?session=${r.node_id}`,
      url: null,
      visibility: r.visibility,
    }));
  }
}
