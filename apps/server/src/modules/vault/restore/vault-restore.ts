import {
  type ArchiveFile,
  ArchivePart,
  ArchiveQuery,
  ArchiveRecord,
  RuleViolation,
  type Sql,
} from '../../platform';
import {
  RestoredAppMark,
  RestoredCategory,
  RestoredEdge,
  RestoredPin,
  RestoredPostMark,
  RestoredWiki,
} from './restored-items';
import { RestoredSession } from './restored-session';
import { RestoredTranscript } from './restored-transcript';
import { VaultRestoreRepository } from './vault-restore.repository';

// 복원에서 vault의 몫: 카테고리, wiki, 세션과 그 원문, 선, 고정한 점 위치, 글 자리 사본과 앱 공개 여부 사본.
// 이벤트를 남기지 않는다: 정리 요청과 일 요청이 생기지 않고, 일꾼이 할 일도 없다.
// 공개 저장소에서 받은 묶음에는 vault 파일이 없다. 그때는 빈 채로 넘어가고 글 자리와 앱만 채운다.
// 앱 파일이 없는데 공개 · 링크 공개 글이 있으면 앱이 생기기 전의 백업이다: blog와 같은 규칙으로 기본 앱(id = 공간 id, 공개)에 넣는다.
export class VaultRestore extends ArchivePart {
  private static readonly CATEGORIES = 'vault/categories.yml';
  private static readonly GRAPH = 'vault/graph.json';
  private static readonly WIKI = /^vault\/wikis\/[^/]+\.md$/;
  private static readonly SESSION = /^vault\/sessions\/.+\.md$/;
  private static readonly TRANSCRIPT = /^vault\/transcripts\/.+\.md$/;
  private static readonly POST = /^blog\/posts\/.+\.md$/;
  private static readonly APP = /^blog\/apps\/[^/]+\.yml$/;

  private constructor(
    private readonly categories: readonly RestoredCategory[],
    private readonly wikis: readonly RestoredWiki[],
    private readonly sessions: readonly RestoredSession[],
    /** 세션 id → 그 세션의 원문 (번호 순) */
    private readonly transcripts: ReadonlyMap<string, readonly RestoredTranscript[]>,
    private readonly edges: readonly RestoredEdge[],
    private readonly pins: readonly RestoredPin[],
    private readonly marks: readonly RestoredPostMark[],
    /** 앱 공개 여부 사본. 앱이 생기기 전의 백업이면 null (기본 앱 하나) */
    private readonly apps: readonly RestoredAppMark[] | null,
    private readonly findings: readonly string[],
  ) {
    super();
  }

  static read(files: readonly ArchiveFile[]): VaultRestore {
    const categories: RestoredCategory[] = [];
    const wikis: RestoredWiki[] = [];
    const sessions: RestoredSession[] = [];
    const transcripts: RestoredTranscript[] = [];
    const marks: RestoredPostMark[] = [];
    const apps: RestoredAppMark[] = [];
    let graph: ArchiveFile | null = null;
    for (const file of files) {
      if (VaultRestore.POST.test(file.path)) {
        marks.push(RestoredPostMark.read(VaultRestore.document(file, 'post', ArchiveQuery.FORMAT)));
      } else if (VaultRestore.APP.test(file.path)) {
        const text = VaultRestore.textOf(file);
        for (const record of ArchiveRecord.listOfYaml(file.path, text))
          apps.push(RestoredAppMark.read(record));
      } else if (file.path === VaultRestore.CATEGORIES) {
        const text = VaultRestore.textOf(file);
        for (const record of ArchiveRecord.listOfYaml(file.path, text))
          categories.push(RestoredCategory.read(record));
      } else if (file.path === VaultRestore.GRAPH) {
        graph = file;
      } else if (VaultRestore.WIKI.test(file.path)) {
        wikis.push(RestoredWiki.read(VaultRestore.document(file, 'wiki', ArchiveQuery.FORMAT)));
      } else if (VaultRestore.SESSION.test(file.path)) {
        sessions.push(
          RestoredSession.read(VaultRestore.document(file, 'session', ArchiveQuery.FORMAT)),
        );
      } else if (VaultRestore.TRANSCRIPT.test(file.path)) {
        transcripts.push(
          RestoredTranscript.read(VaultRestore.document(file, 'transcript', ArchiveQuery.FORMAT)),
        );
      } else if (file.path.startsWith('vault/')) {
        throw new RuleViolation(`모르는 파일이에요: ${file.path}`);
      }
    }
    const former = apps.length === 0 && marks.some((m) => m.shown);
    return VaultRestore.checked(categories, wikis, sessions, transcripts, graph, [
      marks,
      former ? null : apps,
    ]);
  }

  /** 서로 가리키는 것을 맞춰 본다. 휴지통의 wiki·점을 가리키는 값은 옛 백업에 남아 있을 수 있어 멈추지 않고 뺀다 */
  private static checked(
    categories: readonly RestoredCategory[],
    wikis: readonly RestoredWiki[],
    sessions: readonly RestoredSession[],
    transcripts: readonly RestoredTranscript[],
    graph: ArchiveFile | null,
    [marks, apps]: readonly [readonly RestoredPostMark[], readonly RestoredAppMark[] | null],
  ): VaultRestore {
    const nodes = [...categories, ...wikis, ...sessions].map((n) => n.id);
    VaultRestore.assertUnique(nodes, 'id');
    VaultRestore.assertUnique(
      categories.map((c) => c.slug),
      '카테고리 주소',
    );
    VaultRestore.assertUnique(
      wikis.map((w) => w.slug),
      'wiki 주소',
    );
    const categoryIds = new Set(categories.map((c) => c.id));
    const missing = wikis.find((w) => w.categoryId !== null && !categoryIds.has(w.categoryId));
    if (missing)
      throw new RuleViolation(
        `vault/wikis/${missing.slug}.md: 없는 카테고리를 가리켜요: ${missing.categoryId}`,
      );

    const [allEdges, pins] = VaultRestore.readGraph(graph);
    VaultRestore.assertUnique(
      allEdges.map((e) => e.id),
      '선 id',
    );
    const known = new Set(nodes);
    const edges = allEdges.filter((e) => known.has(e.src) && known.has(e.dst));
    const wikiIds = new Set(wikis.map((w) => w.id));
    const orphans = sessions.filter((s) => s.wikiId !== null && !wikiIds.has(s.wikiId));
    const findings = [
      ...(nodes.length === 0 ? ['vault 파일이 없어요: 글과 사진만 들어와요'] : []),
      ...(allEdges.length > edges.length
        ? [`끝점이 없는 선 ${allEdges.length - edges.length}개는 빼요`]
        : []),
      ...(orphans.length > 0
        ? [`대표 wiki가 없는 세션 ${orphans.length}개는 도착 구역으로 가요`]
        : []),
    ];
    const bySession = VaultRestore.transcriptsOf(sessions, transcripts);
    return new VaultRestore(
      categories,
      wikis,
      sessions,
      bySession,
      edges,
      pins,
      marks,
      apps,
      findings,
    );
  }

  /**
   * 원문을 세션별로 모으고 맞춰 본다: 들어오는 세션의 원문이어야 하고, 세션 안에서 번호가 1부터 이어지고 내용이 겹치지 않는다
   * (DB의 UNIQUE에 걸리기 전에 어느 파일인지 알린다). 빠진 번호 · 노트를 쓴 원문이 없으면 파일을 잃은 묶음이라 멈춘다
   */
  private static transcriptsOf(
    sessions: readonly RestoredSession[],
    transcripts: readonly RestoredTranscript[],
  ): ReadonlyMap<string, readonly RestoredTranscript[]> {
    VaultRestore.assertUnique(
      transcripts.map((t) => t.id),
      '원문 id',
    );
    const grouped = new Map<string, RestoredTranscript[]>(sessions.map((s) => [s.id, []]));
    for (const t of transcripts) {
      const list = grouped.get(t.sessionId);
      if (!list) throw new RuleViolation(`${t.path}: 없는 세션의 원문이에요: ${t.sessionId}`);
      list.push(t);
    }
    for (const session of sessions) {
      const list = (grouped.get(session.id) ?? []).sort((a, b) => a.seq - b.seq);
      const hashes = new Set<string>();
      list.forEach((t, i) => {
        if (t.seq !== i + 1)
          throw new RuleViolation(
            `${t.path}: 원문 번호가 1부터 이어지지 않아요 (${i + 1}번이 없어요)`,
          );
        if (hashes.has(t.hash))
          throw new RuleViolation(`${t.path}: 같은 내용의 원문이 이미 있어요`);
        hashes.add(t.hash);
      });
      if (session.notedSeq > list.length)
        throw new RuleViolation(
          `세션 ${session.id}: 노트를 쓴 원문(${session.notedSeq}번)이 없어요`,
        );
    }
    return grouped;
  }

  private static readGraph(
    file: ArchiveFile | null,
  ): readonly [readonly RestoredEdge[], readonly RestoredPin[]] {
    if (!file) return [[], []];
    let parsed: { edges?: unknown; pinned_nodes?: unknown };
    try {
      parsed = JSON.parse(VaultRestore.textOf(file));
    } catch (error) {
      if (error instanceof RuleViolation) throw error;
      throw new RuleViolation(`${file.path}: JSON으로 읽을 수 없어요`);
    }
    if (!Array.isArray(parsed.edges) || !Array.isArray(parsed.pinned_nodes))
      throw new RuleViolation(`${file.path}: edges와 pinned_nodes가 없어요`);
    return [
      parsed.edges.map((e) => RestoredEdge.read(ArchiveRecord.ofJson(file.path, e))),
      parsed.pinned_nodes.map((p) => RestoredPin.read(ArchiveRecord.ofJson(file.path, p))),
    ];
  }

  get counts(): ReadonlyMap<string, number> {
    return VaultRestore.present([
      ['카테고리', this.categories.length],
      ['wiki', this.wikis.length],
      ['세션', this.sessions.length],
      ['원문', [...this.transcripts.values()].reduce((sum, list) => sum + list.length, 0)],
      ['선', this.edges.length],
    ]);
  }

  override get notes(): readonly string[] {
    return this.findings;
  }

  async existing(tx: Sql): Promise<ReadonlyMap<string, number>> {
    const found = await new VaultRestoreRepository(tx).existing();
    return VaultRestore.present([
      ['카테고리', found.get('category') ?? 0],
      ['wiki', found.get('wiki') ?? 0],
      ['세션', found.get('session') ?? 0],
    ]);
  }

  async write(tx: Sql, spaceId: string): Promise<readonly string[]> {
    const repository = new VaultRestoreRepository(tx);
    const wikiIds = new Set(this.wikis.map((w) => w.id));
    for (const category of this.categories) await repository.saveCategory(spaceId, category);
    for (const wiki of this.wikis) await repository.saveWiki(spaceId, wiki);
    for (const session of this.sessions) {
      const live = session.wikiId !== null && wikiIds.has(session.wikiId);
      const transcripts = this.transcripts.get(session.id) ?? [];
      await repository.saveSession(spaceId, session, live ? session.wikiId : null, transcripts);
    }
    for (const edge of this.edges) await repository.saveEdge(spaceId, edge);
    for (const app of this.apps ?? [RestoredAppMark.former(spaceId)])
      await repository.saveAppMark(spaceId, app);
    for (const mark of this.marks) {
      const live = mark.mainWikiId !== null && wikiIds.has(mark.mainWikiId);
      const app = this.apps === null ? spaceId : mark.appId;
      await repository.savePostMark(spaceId, mark, live ? mark.mainWikiId : null, app);
    }
    const placed = await repository.savePins(spaceId, this.pins);
    return placed < this.pins.length
      ? [`그래프 보기가 없어 고정한 점 위치 ${this.pins.length - placed}개는 넣지 않았어요`]
      : [];
  }
}
