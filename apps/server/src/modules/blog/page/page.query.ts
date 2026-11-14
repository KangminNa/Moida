import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseQuery,
  BlobStore,
  Database,
  Leases,
  LibraryInput,
  type LibraryRow,
  NotFound,
  SecretBox,
} from '../../platform';
import type { PageRevisionRow, PageRow } from '../blog.tables';
import { Page } from './page';
import type { PageBaseInput, PageRevisionInput, PageSiteInput, ReadPageInput } from './page.input';
import {
  PageBaseView,
  PageChangesView,
  PageDetailView,
  PageListView,
  PageRevisionView,
  PageView,
  PublicPageListView,
  PublicPageView,
} from './page.view';
import { PageDataDiff } from './page-data-diff.policy';
import { PageFiles } from './page-files';
import { PageTicket } from './page-ticket';

/** 바깥 주소의 답: 보낼 파일이거나, 다른 주소로 보내기 */
export class PageSiteAnswer {
  /**
   * 페이지 안의 스크립트가 우리 로그인에 닿지 못하게 격리해서 연다 (같은 주소지만 다른 출처로 취급된다).
   * 틀 안에 넣는 것은 이 사이트(콘솔의 미리 보기)만
   */
  static readonly CSP =
    "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads; frame-ancestors 'self'";

  private constructor(
    readonly redirect: string | null,
    readonly stream: Readable | null,
    readonly type: string,
    readonly size: number,
    readonly cacheControl: string,
  ) {}

  static to(url: string): PageSiteAnswer {
    return new PageSiteAnswer(url, null, '', 0, 'no-store');
  }

  static file(stream: Readable, name: string, size: number, isPublic: boolean): PageSiteAnswer {
    return new PageSiteAnswer(
      null,
      stream,
      PageFiles.typeOf(name),
      size,
      // 보이는 판이 바뀌면 곧 반영되게 짧게. 비공개는 어디에도 남기지 않는다
      isPublic ? 'public, max-age=60' : 'private, no-store',
    );
  }
}

// 페이지 읽기. 콘솔의 목록 · 상세는 주인만, 방문자는 공개 페이지의 이름 · 제목만 본다.
// 바깥 주소(/pages/<이름>/…)는 공개 페이지면 누구나, 비공개면 주인만: 방문자에게는 없는 페이지와 똑같이 답한다.
@Injectable()
export class PageQuery extends BaseQuery {
  /** 보관함의 종류 (페이지) */
  static readonly LIBRARY_KIND = 'page';
  /** 바깥 주소의 앞부분 (웹이 /pages/…를 api/pages/site/…로 넘긴다) */
  static readonly SITE = '/pages';
  private static readonly MISSING = '없는 페이지예요';
  /** 자라는 페이지의 데이터 파일과 읽는 크기 */
  private static readonly DATA = 'data.json';
  private static readonly DATA_MAX = 1024 * 1024;
  /** page_base가 내용까지 주는 글 파일과 그 크기의 합 */
  private static readonly TEXT = /\.(html?|css|m?js|json|md|txt|csv|svg|xml)$/i;
  private static readonly BASE_TEXT_MAX = 300 * 1024;

  constructor(
    db: Database,
    private readonly blobs: BlobStore,
    private readonly box: SecretBox,
    private readonly leases: Leases,
  ) {
    super(db);
  }

  async list(actor: Actor): Promise<PageListView | PublicPageListView> {
    const all = actor.kind === 'owner';
    const rows = await this.sql<(PageRow & { last_task_id: string | null })[]>`
      SELECT p.*, (SELECT r.task_id FROM blog.page_revisions r
                   WHERE r.page_id = p.id AND r.seq = p.revisions) AS last_task_id
      FROM blog.pages p
      WHERE ${this.inSpace(actor)} ${all ? this.sql`` : this.sql`AND p.visibility = ${Page.PUBLIC}`}
      ORDER BY p.updated_at DESC, p.id DESC`;
    return all
      ? new PageListView(rows.map((r) => new PageView(r, r.last_task_id)))
      : new PublicPageListView(rows.map((r) => new PublicPageView(r)));
  }

  /** 페이지 하나와 판 목록 (새 판부터). 주인만 */
  async detail(actor: Actor, req: ReadPageInput): Promise<PageDetailView> {
    actor.assertOwner();
    const [page] = await this.sql<PageRow[]>`
      SELECT p.* FROM blog.pages p WHERE ${this.inSpace(actor)} AND p.id = ${req.id}`;
    if (!page) throw new NotFound(PageQuery.MISSING);
    const revisions = await this.sql<PageRevisionRow[]>`
      SELECT * FROM blog.page_revisions WHERE page_id = ${page.id} ORDER BY seq DESC`;
    // 확인 대기 판은 그 판에 묶인 보기 표로 미리 본다 (공개 페이지의 바깥 주소는 보이는 판만 낸다)
    const pending = page.pending_seq;
    const preview =
      pending === null
        ? null
        : `${PageQuery.SITE}/${PageTicket.MARK}${new PageTicket(page.id, pending).seal(this.box, new Date())}/${encodeURIComponent(page.name)}/${PageFiles.ENTRY}`;
    return new PageDetailView(
      new PageView(page),
      revisions.map((r) => new PageRevisionView(r, PageFiles.of(r.files).toJSON())),
      preview,
    );
  }

  /**
   * 바깥 주소 하나. 파일 이름이 없으면 문(index.html)으로 보내고, 비공개 페이지를 주인이 열면 보기 표가 든 주소로 보낸다
   * (격리된 페이지 안에서는 쿠키가 실리지 않아 딸린 파일을 표로 받는다)
   */
  async site(actor: Actor, req: PageSiteInput, now: Date): Promise<PageSiteAnswer> {
    const ticket = req.ticket === null ? null : PageTicket.open(this.box, req.ticket, now);
    const ticketPage = ticket?.pageId ?? null;
    const [page] = await this.sql<PageRow[]>`
      SELECT p.* FROM blog.pages p WHERE ${this.inSpace(actor)} AND p.name = ${req.name}
        ${ticketPage === null ? this.sql`` : this.sql`AND p.id = ${ticketPage}`}`;
    if (!page) throw new NotFound(PageQuery.MISSING);
    const isPublic = page.visibility === Page.PUBLIC;
    const name = encodeURIComponent(page.name);
    if (ticketPage === null && !isPublic) {
      if (actor.kind !== 'owner') throw new NotFound(PageQuery.MISSING);
      const ticket = new PageTicket(page.id).seal(this.box, now);
      return PageSiteAnswer.to(
        `${PageQuery.SITE}/${PageTicket.MARK}${ticket}/${name}/${encodeURIComponent(req.file ?? PageFiles.ENTRY)}`,
      );
    }
    if (req.file === null) {
      const base =
        req.ticket === null ? PageQuery.SITE : `${PageQuery.SITE}/${PageTicket.MARK}${req.ticket}`;
      return PageSiteAnswer.to(`${base}/${name}/${PageFiles.ENTRY}`);
    }
    const seq = ticket?.seq ?? page.current_seq;
    const [revision] = await this.sql<PageRevisionRow[]>`
      SELECT * FROM blog.page_revisions WHERE page_id = ${page.id} AND seq = ${seq}`;
    const file = revision ? PageFiles.of(revision.files).find(req.file) : null;
    const blob = file ? await this.blobs.find(file.blobHash) : null;
    if (!file || !blob) throw new NotFound(PageQuery.MISSING);
    return PageSiteAnswer.file(
      await this.blobs.open(file.blobHash),
      file.name,
      blob.size,
      isPublic && ticketPage === null,
    );
  }

  /**
   * 판 하나의 바뀐 점 (자라는 페이지): 앞 판과 data.json을 비교한다 (PageDataDiff). 주인만.
   * 앞 판에 data.json이 없으면 모두 더해진 것, 이 판에 없으면 data: false
   */
  async changes(actor: Actor, req: PageRevisionInput): Promise<PageChangesView> {
    actor.assertOwner();
    const [page] = await this.sql<PageRow[]>`
      SELECT p.* FROM blog.pages p WHERE ${this.inSpace(actor)} AND p.id = ${req.id}`;
    if (!page) throw new NotFound(PageQuery.MISSING);
    const rows = await this.sql<PageRevisionRow[]>`
      SELECT * FROM blog.page_revisions WHERE page_id = ${page.id} AND seq IN (${req.seq}, ${req.seq - 1})`;
    const now = rows.find((r) => r.seq === req.seq);
    if (!now) throw new NotFound(`없는 버전이에요: ${req.seq}`);
    const after = await this.dataOf(now);
    if (after === undefined) return new PageChangesView(req.seq, false, [], false);
    const before = rows.find((r) => r.seq === req.seq - 1);
    const diff = PageDataDiff.between(before ? await this.dataOf(before) : undefined, after);
    return new PageChangesView(req.seq, true, diff.changes, diff.truncated);
  }

  /**
   * 러너가 쥔 만들기 일이 고칠 페이지 (MCP page_base, 2차 5단계): 가장 새 판의 파일과 방향. 글 파일은 내용까지
   * (모두 BASE_TEXT_MAX바이트까지), 그 밖은 이름 · 크기만. 페이지 주문이 없거나 새 페이지면 page_id null
   */
  async base(actor: Actor, req: PageBaseInput): Promise<PageBaseView> {
    actor.assertCan(Actor.RUN);
    const work = await this.leases.of(actor, req.taskId);
    const pageId = (work.payload as { page?: { pageId?: unknown } } | null)?.page?.pageId;
    if (work.kind !== 'make' || typeof pageId !== 'string') return new PageBaseView(null, 0, []);
    const [page] = await this.sql<PageRow[]>`
      SELECT p.* FROM blog.pages p WHERE p.space_id = ${actor.requireSpace()} AND p.id = ${pageId}`;
    if (!page || page.revisions === 0) return new PageBaseView(null, 0, []);
    const [revision] = await this.sql<PageRevisionRow[]>`
      SELECT * FROM blog.page_revisions WHERE page_id = ${page.id} AND seq = ${page.revisions}`;
    let budget = PageQuery.BASE_TEXT_MAX;
    const files = [];
    for (const f of revision ? PageFiles.of(revision.files).toJSON() : []) {
      const readable = PageQuery.TEXT.test(f.name) && f.sizeBytes <= budget;
      const text = readable ? await this.blobs.text(f.blobHash, budget) : null;
      if (text !== null) budget -= f.sizeBytes;
      files.push({ name: f.name, size: f.sizeBytes, text });
    }
    return new PageBaseView(page, page.revisions, files);
  }

  /** 판의 data.json 값. 없거나 읽을 수 없으면 undefined */
  private async dataOf(revision: PageRevisionRow): Promise<unknown> {
    const file = PageFiles.of(revision.files).find(PageQuery.DATA);
    const text = file ? await this.blobs.text(file.blobHash, PageQuery.DATA_MAX) : null;
    if (text === null) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /** hashes 가운데 판이 가리키는 파일 (BlobStore.registerUse: 쓰는 동안 platform이 파일을 지우지 않게) */
  async usedBlobs(actor: Actor, hashes: readonly string[]): Promise<string[]> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql<{ hash: string }[]>`
      SELECT DISTINCT f->>'blobHash' AS hash
      FROM blog.page_revisions r, jsonb_array_elements(r.files) f
      WHERE f->>'blobHash' = ANY(${hashes as string[]}::text[])`;
    return rows.map((row) => row.hash);
  }

  private inSpace(actor: Actor) {
    return actor.spaceId === null ? this.sql`TRUE` : this.sql`p.space_id = ${actor.spaceId}`;
  }

  /** 보관함의 페이지 (2차 5단계, platform LibraryQuery에 등록). 공개 페이지는 바깥 주소도 */
  async library(actor: Actor, filter: LibraryInput): Promise<readonly LibraryRow[]> {
    actor.assertOwner();
    if (filter.project !== null) return [];
    const rows = await this.sql<
      Pick<PageRow, 'id' | 'name' | 'title' | 'visibility' | 'updated_at'>[]
    >`
      SELECT id, name, title, visibility, updated_at FROM blog.pages
      WHERE space_id = ${actor.requireSpace()} ${this.libraryWindow('updated_at', 'id', filter)}
      ORDER BY updated_at DESC, id DESC LIMIT ${LibraryInput.PAGE + 1}`;
    return rows.map((r) => ({
      kind: PageQuery.LIBRARY_KIND,
      id: r.id,
      title: r.title,
      project: null,
      at: r.updated_at,
      href: `/admin/library/pages/${r.id}`,
      url: r.visibility === Page.PUBLIC ? `/pages/${r.name}/` : null,
      visibility: r.visibility,
    }));
  }
}
