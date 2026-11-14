import { BaseEntity, DomainEvent, NotFound, RuleViolation, TableEntity } from '../../platform';
import type { PageNew, PageRevisionNew, PageRow } from '../blog.tables';
import { SlugPolicy } from '../post/slug.policy';
import { PageView } from './page.view';
import type { PageFiles } from './page-files';

// 페이지 하나 (blog.pages + blog.page_revisions, 기획서 결정 2026-11-12).
// AI가 만든 HTML 묶음을 블로그처럼 바깥 주소(/pages/<이름>/)로 내보낸다. 판은 추가만 하고(트리거), 보이는 판(current_seq)을 옮긴다.
// 비공개 페이지는 새 판이 오면 곧바로 그 판이 보인다. 공개 페이지의 새 판은 확인 대기(pending_seq)로 두고, 관리자가
// "이 버전 보이기"(switchTo)를 누를 때 보인다 (2차 5단계 자라는 페이지, 원칙 7). 방문자에게 보이게 하는 것도 주인만 정한다 (원칙 5).
// 방향(direction): 관리자만 고치는 이 페이지의 쓰임. 새 판을 만드는 AI가 지시와 함께 읽는다 (page_base).
export class Page extends TableEntity<PageRow, PageNew> {
  static readonly PRIVATE = 'private';
  static readonly PUBLIC = 'public';
  static readonly VISIBILITIES: readonly string[] = [Page.PRIVATE, Page.PUBLIC];
  static readonly TITLE_MAX = 120;
  static readonly NOTE_MAX = 4000;
  static readonly CHANGED = 'blog.page.changed';
  /** 공개 페이지에 새 판이 와서 확인을 기다린다 · 기다리던 판이 보이게 됐다 (알림이 쓴다) */
  static readonly PENDING = 'blog.page.pending';
  static readonly SHOWN = 'blog.page.shown';
  static readonly DIRECTION_MAX = 4000;
  /** 제목에 글자가 없을 때의 이름 */
  private static readonly FALLBACK_NAME = 'page';
  /** 이번에 쌓을 판 (saveParts가 넣는다) */
  private added: PageRevisionNew | null = null;

  /** 첫 판과 함께 만든다. 이름은 공간 안에서 겹치지 않게 부르는 쪽이 정한다 (Page.nameOf) */
  static open(spaceId: string, name: string, title: string, now: Date): Page {
    return new Page(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        name,
        title: Page.titleOf(title),
        visibility: Page.PRIVATE,
        current_seq: 0,
        revisions: 0,
        direction: '',
        pending_seq: null,
        created_at: now,
        updated_at: now,
      },
      true,
    );
  }

  static restore(row: PageRow): Page {
    return new Page(row);
  }

  /** 제목에서 만든 주소 이름 (예: "서울 데이트 코스" → "서울-데이트-코스") */
  static nameOf(title: string): string {
    return /[\p{L}\p{N}]/u.test(title) ? SlugPolicy.fromTitle(title) : Page.FALLBACK_NAME;
  }

  get name(): string {
    return this.row.name;
  }

  /** 가장 새 판의 번호 (확인 대기 판이 있으면 그 판). 판이 없으면 0 */
  get latestSeq(): number {
    return this.row.revisions;
  }

  /**
   * 새 판을 쌓는다. 비공개 페이지(와 첫 판)는 바로 그 판이 보이고, 공개 페이지는 관리자가 확인할 때까지 기다린다
   * (앞의 확인 대기 판이 있으면 새 판이 그 자리를 잇는다)
   */
  publish(files: PageFiles, taskId: string, runId: string, note: string, now: Date): void {
    const seq = this.row.revisions + 1;
    const held = this.row.visibility === Page.PUBLIC && this.row.current_seq > 0;
    this.put('revisions', seq);
    this.put(held ? 'pending_seq' : 'current_seq', seq);
    if (!held) this.put('pending_seq', null);
    this.put('updated_at', now);
    this.added = {
      id: BaseEntity.newId(),
      page_id: this.id,
      seq,
      files: files.toJSON(),
      task_id: taskId,
      run_id: runId,
      note: note.slice(0, Page.NOTE_MAX),
      created_at: now,
    };
    this.announce();
    if (held) {
      const { space_id: spaceId, title } = this.row;
      this.record(new DomainEvent(Page.PENDING, 1, spaceId, { pageId: this.id, title, seq }));
    }
  }

  /** 주인이 제목 · 공개 범위 · 방향을 바꾼다. 주지 않은 것은 그대로 */
  edit(title: string | null, visibility: string | null, direction: string | null, now: Date): void {
    if (title !== null) this.put('title', Page.titleOf(title));
    if (direction !== null) this.put('direction', direction.trim().slice(0, Page.DIRECTION_MAX));
    if (visibility !== null) {
      if (!Page.VISIBILITIES.includes(visibility))
        throw new RuleViolation(`공개 범위는 ${Page.VISIBILITIES.join(' · ')} 중 하나예요`);
      this.put('visibility', visibility);
    }
    this.put('updated_at', now);
    this.announce();
  }

  /**
   * 보이는 판을 옮긴다 (되돌리기 · 확인 대기 판 보이기도 같다). 확인을 기다리던 판이나 그보다 새 판을 보이면 기다림이 끝난다.
   * 이미 그 판이면 아무것도 바뀌지 않는다
   */
  switchTo(seq: number, now: Date): void {
    if (seq < 1 || seq > this.row.revisions) throw new NotFound(`없는 버전이에요: ${seq}`);
    const pending = this.row.pending_seq ?? null;
    const shown = pending !== null && seq >= pending;
    if (seq === this.row.current_seq && !shown) return;
    this.put('current_seq', seq);
    if (shown) this.put('pending_seq', null);
    this.put('updated_at', now);
    this.announce();
    if (shown)
      this.record(new DomainEvent(Page.SHOWN, 1, this.row.space_id, { pageId: this.id, seq }));
  }

  /** 저장할 새 판 (Repository가 부른다) */
  get addedRevision(): PageRevisionNew | null {
    return this.added;
  }

  view(): PageView {
    return new PageView(this.row);
  }

  private static titleOf(title: string): string {
    const text = title.trim().slice(0, Page.TITLE_MAX);
    if (!text) throw new RuleViolation('제목을 적어 주세요');
    return text;
  }

  private announce(): void {
    this.record(
      new DomainEvent(Page.CHANGED, 1, this.row.space_id, {
        pageId: this.id,
        name: this.row.name,
        currentSeq: this.row.current_seq,
        visibility: this.row.visibility,
      }),
    );
  }
}
