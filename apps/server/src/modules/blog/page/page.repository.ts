import { RuleViolation, TableRepository } from '../../platform';
import { pageRevisions, pages } from '../blog.schema';
import type { PageRow } from '../blog.tables';
import { Page } from './page';
import { PageFiles } from './page-files';

// blog.pages ↔ Page. 판(blog.page_revisions)은 saveParts로 함께 넣는다 (추가만).
export class PageRepository extends TableRepository<PageRow, Page> {
  protected readonly table = pages;
  protected readonly noun = '페이지';

  protected toEntity(row: PageRow): Page {
    return Page.restore(row);
  }

  /** 공간의 페이지를 만들거나 판을 쌓는 동안 하나씩만: 이름이 겹치지 않게, 같은 실행의 판이 둘 생기지 않게 */
  async lockSpace(spaceId: string): Promise<void> {
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`blog.pages:${spaceId}`}, 0))`;
  }

  /** 그 실행이 만든 판이 이미 있는가 (같은 이벤트를 두 번 받았을 때) */
  async hasRun(spaceId: string, runId: string): Promise<boolean> {
    const [row] = await this.sql`
      SELECT 1 FROM blog.page_revisions r JOIN blog.pages p ON p.id = r.page_id
      WHERE p.space_id = ${spaceId} AND r.run_id = ${runId} LIMIT 1`;
    return row !== undefined;
  }

  /** 공간에서 아직 안 쓰는 이름: 원하는 이름이 있으면 뒤에 -2, -3 …을 붙인다 */
  async freeName(spaceId: string, wanted: string): Promise<string> {
    const rows = await this.sql<{ name: string }[]>`
      SELECT name FROM blog.pages
      WHERE space_id = ${spaceId} AND (name = ${wanted} OR name LIKE ${`${wanted}-%`})`;
    const taken = new Set(rows.map((r) => r.name));
    if (!taken.has(wanted)) return wanted;
    for (let n = 2; ; n += 1) if (!taken.has(`${wanted}-${n}`)) return `${wanted}-${n}`;
  }

  /** 페이지 앱을 만들며 넣을 페이지 (잠근다). 이미 다른 앱에 든 페이지는 넣지 않는다 */
  async lockForApp(spaceId: string, pageId: string): Promise<Page> {
    const page = await this.lock(spaceId, pageId);
    if (page.appId !== null) throw new RuleViolation('이미 앱에 든 페이지예요');
    return page;
  }

  /** 앱에 든 페이지를 잠근다 (페이지 앱을 지울 때 그 페이지를 앱 밖으로) */
  async lockInApp(spaceId: string, appId: string): Promise<Page[]> {
    return this.find({ space_id: spaceId, app_id: appId }, { lock: true });
  }

  /** 메뉴에 있는 다른 페이지의 수 (페이지 하나 메뉴는 하나만) */
  async othersIn(menuId: string, exceptId: string): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM blog.pages WHERE menu_id = ${menuId} AND id <> ${exceptId}`;
    return row?.n ?? 0;
  }

  /** 판 하나의 파일 목록. 판이 없으면 null */
  async filesOf(pageId: string, seq: number): Promise<PageFiles | null> {
    const row = await this.row(pageRevisions, { page_id: pageId, seq }, { columns: ['files'] });
    return row ? PageFiles.of(row.files) : null;
  }

  protected override async saveParts(page: Page): Promise<void> {
    const revision = page.addedRevision;
    if (revision) await this.insertRows(pageRevisions, revision);
  }
}
